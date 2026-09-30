import { Response } from 'express';
import { EstimateModel } from '../models/estimateModel';
import { AuthRequest } from '../middleware/authMiddleware';
import { prisma } from '../config/db';
import { generatePDFStream } from '../utils/pdfGenerator';

export async function getEstimates(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const estimates = await EstimateModel.findManyByCompany(companyId);
    res.json(estimates);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getEstimateById(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;
    const estimate = await EstimateModel.findById(id, companyId);
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });
    res.json(estimate);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getEstimatePDF(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;

    const estimate = await EstimateModel.findById(id, companyId);
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });

    generatePDFStream(
      res,
      {
        title: 'ESTIMATE',
        docNumber: estimate.estimateNumber,
        issueDate: estimate.issueDate,
        dueDate: estimate.expiryDate,
        status: estimate.status,
        currency: estimate.company.currency || 'USD',
        company: estimate.company,
        recipient: {
          name: estimate.client.name,
          contactPerson: estimate.client.contactPerson,
          email: estimate.client.email,
          phone: estimate.client.phone,
          taxId: estimate.client.taxId,
          address: estimate.client.billingAddress || estimate.client.shippingAddress,
        },
        recipientLabel: 'ESTIMATE FOR',
        items: estimate.items,
        subtotal: estimate.subtotal,
        taxAmount: estimate.taxAmount,
        totalAmount: estimate.totalAmount,
        notes: estimate.notes,
      },
      `Estimate_${estimate.estimateNumber}`
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function createEstimate(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });

    const { clientId, estimateNumber, issueDate, expiryDate, notes, items } = req.body;

    if (!clientId) {
      return res.status(400).json({ error: 'clientId is required. Please select or create a client first.' });
    }

    const clientExists = await prisma.client.findFirst({ where: { id: clientId, companyId } });
    if (!clientExists) {
      return res.status(400).json({
        error: `Client with ID "${clientId}" does not exist for this tenant. Please specify a valid clientId from GET /api/clients or create a new client.`,
      });
    }

    let subtotal = 0;
    let taxAmount = 0;

    const formattedItems = (items || []).map((item: any) => {
      const itemSubtotal = (parseFloat(item.quantity) || 1) * (parseFloat(item.unitPrice) || 0);
      const itemTax = itemSubtotal * ((parseFloat(item.taxRate) || 0) / 100);
      const amount = itemSubtotal + itemTax;
      subtotal += itemSubtotal;
      taxAmount += itemTax;

      return {
        description: item.description,
        quantity: parseFloat(item.quantity) || 1,
        unitPrice: parseFloat(item.unitPrice) || 0,
        taxRate: parseFloat(item.taxRate) || 0,
        amount,
      };
    });

    const totalAmount = subtotal + taxAmount;

    const estimate = await EstimateModel.create({
      companyId,
      clientId,
      estimateNumber: estimateNumber || `EST-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
      issueDate: issueDate ? new Date(issueDate) : new Date(),
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      subtotal,
      taxAmount,
      totalAmount,
      notes,
      items: formattedItems,
    });

    res.status(201).json(estimate);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function convertEstimateToProforma(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;
    const pi = await EstimateModel.convertToProforma(id, companyId);
    res.json(pi);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function convertEstimateToInvoice(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;
    const inv = await EstimateModel.convertToInvoice(id, companyId);
    res.json(inv);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteEstimate(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;
    await EstimateModel.delete(id, companyId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
