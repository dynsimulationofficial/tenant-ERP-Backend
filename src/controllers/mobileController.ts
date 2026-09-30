import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db';
import { UserModel } from '../models/userModel';
import { CompanyModel } from '../models/companyModel';
import { ClientModel } from '../models/clientModel';
import { VendorModel } from '../models/vendorModel';
import { ItemModel } from '../models/itemModel';
import { EstimateModel } from '../models/estimateModel';
import { ProformaModel } from '../models/proformaModel';
import { InvoiceModel } from '../models/invoiceModel';
import { PurchaseOrderModel } from '../models/purchaseOrderModel';
import { AuthRequest } from '../middleware/authMiddleware';
import { generateTOTPSecret, generateQRCodeDataURL, verifyTOTPCode } from '../utils/totp';
import { generatePDFStream } from '../utils/pdfGenerator';
import { Role } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'tenant_erp_super_secret_jwt_key_2026';

/**
 * ============================================================================
 * MOBILE AUTHENTICATION CONTROLLERS
 * ============================================================================
 */

export async function mobileRegister(req: Request, res: Response) {
  try {
    const { companyName, name, email, password, currency } = req.body;

    if (!companyName || !name || !email || !password) {
      return res.status(400).json({ error: 'Company Name, User Name, Email, and Password are required' });
    }

    const existingUser = await UserModel.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'Email address is already registered' });
    }

    // 1. Create Tenant Company
    const company = await CompanyModel.create({
      name: companyName,
      currency: currency || 'USD',
    });

    // 2. Hash Password & Create Admin User
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await UserModel.create({
      companyId: company.id,
      name,
      email,
      passwordHash,
      role: Role.ADMIN,
    });

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        companyId: user.companyId,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    const { passwordHash: _, twoFactorSecret: __, ...userWithoutPassword } = user;

    res.status(201).json({
      token,
      tenantId: company.id,
      user: userWithoutPassword,
      company,
      message: 'Tenant company workspace and admin user registered successfully',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileLogin(req: Request, res: Response) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await UserModel.findByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.company) {
      return res.status(400).json({ error: 'User is not associated with any valid tenant company' });
    }

    // Direct Mobile Authentication (Bypasses TOTP 2FA for Mobile Apps)
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        companyId: user.companyId,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    const { passwordHash, twoFactorSecret, ...userWithoutPassword } = user;

    res.json({
      token,
      tenantId: user.companyId,
      user: userWithoutPassword,
      company: user.company,
      message: 'Mobile login successful',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileVerify2FA(req: Request, res: Response) {
  try {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) {
      return res.status(400).json({ error: 'Temporary token and 6-digit TOTP code are required' });
    }

    const decoded = jwt.verify(tempToken, JWT_SECRET) as any;
    if (!decoded || !decoded.userId || !decoded.isTemp2FA) {
      return res.status(401).json({ error: 'Invalid or expired 2FA session' });
    }

    const user = await UserModel.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let secretToVerify = '';
    if (decoded.isFirstTime2FA) {
      secretToVerify = decoded.tempSecret;
    } else {
      if (!user.twoFactorSecret) {
        return res.status(400).json({ error: '2FA secret not configured for this user' });
      }
      secretToVerify = user.twoFactorSecret;
    }

    const isValid = verifyTOTPCode(secretToVerify, code);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid 6-digit Google Authenticator code' });
    }

    if (decoded.isFirstTime2FA) {
      await UserModel.update2FASecret(user.id, decoded.tempSecret);
      await UserModel.set2FAEnabled(user.id, true);
    }

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        companyId: user.companyId,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    const updatedUser = decoded.isFirstTime2FA ? await UserModel.findById(user.id) : user;
    const { passwordHash, twoFactorSecret, ...userWithoutPassword } = updatedUser || user;

    res.json({
      token,
      tenantId: user.companyId,
      user: userWithoutPassword,
      company: user.company,
    });
  } catch (err: any) {
    res.status(401).json({ error: 'Invalid or expired 2FA code verification' });
  }
}

export async function mobileGetMe(req: AuthRequest, res: Response) {
  try {
    if (!req.user || !req.tenantId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const { passwordHash, twoFactorSecret, ...userWithoutPassword } = req.user;
    const company = await CompanyModel.findById(req.tenantId);

    res.json({
      user: userWithoutPassword,
      tenantId: req.tenantId,
      company,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * ============================================================================
 * MOBILE DASHBOARD & ANALYTICS CONTROLLER
 * ============================================================================
 */

export async function mobileGetDashboard(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });

    const company = await CompanyModel.findById(companyId);

    const [
      clientCount,
      vendorCount,
      itemCount,
      estimateCount,
      proformaCount,
      invoiceCount,
      poCount,
      userCount,
      recentInvoices,
      recentEstimates,
      paidInvoicesSum,
      allInvoicesSum,
    ] = await Promise.all([
      prisma.client.count({ where: { companyId } }),
      prisma.vendor.count({ where: { companyId } }),
      prisma.item.count({ where: { companyId } }),
      prisma.estimate.count({ where: { companyId } }),
      prisma.proformaInvoice.count({ where: { companyId } }),
      prisma.invoice.count({ where: { companyId } }),
      prisma.purchaseOrder.count({ where: { companyId } }),
      prisma.user.count({ where: { companyId } }),
      prisma.invoice.findMany({
        where: { companyId },
        include: { client: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.estimate.findMany({
        where: { companyId },
        include: { client: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.invoice.aggregate({
        where: { companyId, status: 'PAID' },
        _sum: { totalAmount: true },
      }),
      prisma.invoice.aggregate({
        where: { companyId },
        _sum: { totalAmount: true },
      }),
    ]);

    const totalRevenue = paidInvoicesSum._sum.totalAmount || 0;
    const totalInvoiced = allInvoicesSum._sum.totalAmount || 0;

    res.json({
      company,
      tenantId: companyId,
      counts: {
        clients: clientCount,
        vendors: vendorCount,
        items: itemCount,
        estimates: estimateCount,
        proformaInvoices: proformaCount,
        invoices: invoiceCount,
        purchaseOrders: poCount,
        users: userCount,
      },
      financials: {
        currency: company?.currency || 'USD',
        totalRevenue,
        totalInvoiced,
      },
      recentInvoices,
      recentEstimates,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * ============================================================================
 * MOBILE TEAM & USER MANAGEMENT CONTROLLERS
 * ============================================================================
 */

export async function mobileGetUsers(req: AuthRequest, res: Response) {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });
    const users = await UserModel.findByCompany(tenantId);
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileCreateUser(req: AuthRequest, res: Response) {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const existingUser = await UserModel.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'Email address is already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await UserModel.create({
      companyId: tenantId,
      name,
      email,
      passwordHash,
      role: role === 'ADMIN' ? Role.ADMIN : Role.STAFF,
    });

    const { passwordHash: _, twoFactorSecret: __, ...userWithoutPassword } = newUser;
    res.status(201).json(userWithoutPassword);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileDeleteUser(req: AuthRequest, res: Response) {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;
    if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

    if (req.user?.id === id) {
      return res.status(400).json({ error: 'Cannot delete your own active account' });
    }

    await UserModel.delete(id, tenantId);
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * ============================================================================
 * MOBILE CLIENT CONTROLLERS
 * ============================================================================
 */

export async function mobileGetClients(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const clients = await ClientModel.findManyByCompany(companyId);
    res.json(clients);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileCreateClient(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });

    const { name, contactPerson, email, phone, taxId, currency, billingAddress, shippingAddress } = req.body;
    if (!name) return res.status(400).json({ error: 'Client name is required' });

    const client = await ClientModel.create({
      companyId,
      name,
      contactPerson,
      email,
      phone,
      taxId,
      currency: currency || 'USD',
      billingAddress,
      shippingAddress,
    });

    res.status(201).json(client);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileDeleteClient(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;
    await ClientModel.delete(id, companyId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * ============================================================================
 * MOBILE VENDOR CONTROLLERS
 * ============================================================================
 */

export async function mobileGetVendors(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const vendors = await VendorModel.findManyByCompany(companyId);
    res.json(vendors);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileCreateVendor(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });

    const { name, contactPerson, email, phone, taxId, currency, address, paymentTerms } = req.body;
    if (!name) return res.status(400).json({ error: 'Vendor name is required' });

    const vendor = await VendorModel.create({
      companyId,
      name,
      contactPerson,
      email,
      phone,
      taxId,
      currency: currency || 'USD',
      address,
      paymentTerms,
    });

    res.status(201).json(vendor);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileDeleteVendor(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;
    await VendorModel.delete(id, companyId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * ============================================================================
 * MOBILE ITEM / INVENTORY CONTROLLERS
 * ============================================================================
 */

export async function mobileGetItems(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const items = await ItemModel.findManyByCompany(companyId);
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileCreateItem(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });

    const { name, sku, type, unitPrice, taxRate, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Item name is required' });

    const item = await ItemModel.create({
      companyId,
      name,
      sku,
      type: type || 'PRODUCT',
      unitPrice: parseFloat(unitPrice) || 0,
      taxRate: parseFloat(taxRate) || 0,
      description,
    });

    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileDeleteItem(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;
    await ItemModel.delete(id, companyId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * ============================================================================
 * MOBILE ESTIMATE CONTROLLERS
 * ============================================================================
 */

export async function mobileGetEstimates(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const estimates = await EstimateModel.findManyByCompany(companyId);
    res.json(estimates);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileGetEstimateById(req: AuthRequest, res: Response) {
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

export async function mobileCreateEstimate(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });

    const { clientId, estimateNumber, issueDate, expiryDate, notes, items } = req.body;

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

export async function mobileConvertEstimateToProforma(req: AuthRequest, res: Response) {
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

export async function mobileConvertEstimateToInvoice(req: AuthRequest, res: Response) {
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

export async function mobileDeleteEstimate(req: AuthRequest, res: Response) {
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

/**
 * ============================================================================
 * MOBILE PROFORMA INVOICE CONTROLLERS
 * ============================================================================
 */

export async function mobileGetProformaInvoices(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const list = await ProformaModel.findManyByCompany(companyId);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileGetProformaById(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;
    const item = await ProformaModel.findById(id, companyId);
    if (!item) return res.status(404).json({ error: 'Proforma Invoice not found' });
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileCreateProformaInvoice(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });

    const { clientId, estimateId, piNumber, issueDate, dueDate, notes, items } = req.body;

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

    const pi = await ProformaModel.create({
      companyId,
      clientId,
      estimateId,
      piNumber: piNumber || `PI-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
      issueDate: issueDate ? new Date(issueDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      subtotal,
      taxAmount,
      totalAmount,
      notes,
      items: formattedItems,
    });

    res.status(201).json(pi);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileConvertProformaToInvoice(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;
    const inv = await ProformaModel.convertToInvoice(id, companyId);
    res.json(inv);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileDeleteProforma(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;
    await ProformaModel.delete(id, companyId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * ============================================================================
 * MOBILE TAX INVOICE CONTROLLERS
 * ============================================================================
 */

export async function mobileGetInvoices(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const invoices = await InvoiceModel.findManyByCompany(companyId);
    res.json(invoices);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileGetInvoiceById(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;
    const invoice = await InvoiceModel.findById(id, companyId);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileCreateInvoice(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });

    const { clientId, estimateId, proformaId, invoiceNumber, issueDate, dueDate, notes, items, paymentMethod } = req.body;

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

    const invoice = await InvoiceModel.create({
      companyId,
      clientId,
      estimateId,
      proformaId,
      invoiceNumber: invoiceNumber || `INV-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
      issueDate: issueDate ? new Date(issueDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      subtotal,
      taxAmount,
      totalAmount,
      paymentMethod,
      notes,
      items: formattedItems,
    });

    res.status(201).json(invoice);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileUpdateInvoiceStatus(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });

    const { id } = req.params;
    const { status, paymentMethod } = req.body;

    const invoice = await InvoiceModel.updateStatus(id, companyId, status, paymentMethod);
    res.json(invoice);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileDeleteInvoice(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;
    await InvoiceModel.delete(id, companyId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * ============================================================================
 * MOBILE PURCHASE ORDER CONTROLLERS
 * ============================================================================
 */

export async function mobileGetPurchaseOrders(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const orders = await PurchaseOrderModel.findManyByCompany(companyId);
    res.json(orders);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileGetPOById(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;
    const order = await PurchaseOrderModel.findById(id, companyId);
    if (!order) return res.status(404).json({ error: 'Purchase Order not found' });
    res.json(order);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileCreatePurchaseOrder(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });

    const { vendorId, poNumber, issueDate, expectedDate, notes, items } = req.body;

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

    const po = await PurchaseOrderModel.create({
      companyId,
      vendorId,
      poNumber: poNumber || `PO-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
      issueDate: issueDate ? new Date(issueDate) : new Date(),
      expectedDate: expectedDate ? new Date(expectedDate) : null,
      subtotal,
      taxAmount,
      totalAmount,
      notes,
      items: formattedItems,
    });

    res.status(201).json(po);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileUpdatePOStatus(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });

    const { id } = req.params;
    const { status } = req.body;

    const po = await PurchaseOrderModel.updateStatus(id, companyId, status);
    res.json(po);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileDeletePurchaseOrder(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;
    await PurchaseOrderModel.delete(id, companyId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * ============================================================================
 * MOBILE PDF GENERATION CONTROLLERS
 * ============================================================================
 */

export async function mobileGetEstimatePDF(req: AuthRequest, res: Response) {
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

export async function mobileGetProformaPDF(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;

    const pi = await ProformaModel.findById(id, companyId);
    if (!pi) return res.status(404).json({ error: 'Proforma Invoice not found' });

    generatePDFStream(
      res,
      {
        title: 'PROFORMA INVOICE',
        docNumber: pi.piNumber,
        issueDate: pi.issueDate,
        dueDate: pi.dueDate,
        status: pi.status,
        currency: pi.company.currency || 'USD',
        company: pi.company,
        recipient: {
          name: pi.client.name,
          contactPerson: pi.client.contactPerson,
          email: pi.client.email,
          phone: pi.client.phone,
          taxId: pi.client.taxId,
          address: pi.client.billingAddress || pi.client.shippingAddress,
        },
        recipientLabel: 'PROFORMA FOR',
        items: pi.items,
        subtotal: pi.subtotal,
        taxAmount: pi.taxAmount,
        totalAmount: pi.totalAmount,
        notes: pi.notes,
      },
      `Proforma_${pi.piNumber}`
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileGetInvoicePDF(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;

    const invoice = await InvoiceModel.findById(id, companyId);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    generatePDFStream(
      res,
      {
        title: 'TAX INVOICE',
        docNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        status: invoice.status,
        currency: invoice.company.currency || 'USD',
        company: invoice.company,
        recipient: {
          name: invoice.client.name,
          contactPerson: invoice.client.contactPerson,
          email: invoice.client.email,
          phone: invoice.client.phone,
          taxId: invoice.client.taxId,
          address: invoice.client.billingAddress || invoice.client.shippingAddress,
        },
        recipientLabel: 'BILL TO',
        items: invoice.items,
        subtotal: invoice.subtotal,
        taxAmount: invoice.taxAmount,
        totalAmount: invoice.totalAmount,
        notes: invoice.notes,
        paymentMethod: invoice.paymentMethod,
      },
      `Invoice_${invoice.invoiceNumber}`
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function mobileGetPOPDF(req: AuthRequest, res: Response) {
  try {
    const companyId = req.tenantId;
    if (!companyId) return res.status(400).json({ error: 'Tenant context required' });
    const { id } = req.params;

    const po = await PurchaseOrderModel.findById(id, companyId);
    if (!po) return res.status(404).json({ error: 'Purchase Order not found' });

    generatePDFStream(
      res,
      {
        title: 'PURCHASE ORDER',
        docNumber: po.poNumber,
        issueDate: po.issueDate,
        dueDate: po.expectedDate,
        status: po.status,
        currency: po.company.currency || 'USD',
        company: po.company,
        recipient: {
          name: po.vendor.name,
          contactPerson: po.vendor.contactPerson,
          email: po.vendor.email,
          phone: po.vendor.phone,
          taxId: po.vendor.taxId,
          address: po.vendor.address,
        },
        recipientLabel: 'VENDOR / SUPPLIER',
        items: po.items,
        subtotal: po.subtotal,
        taxAmount: po.taxAmount,
        totalAmount: po.totalAmount,
        notes: po.notes,
      },
      `PurchaseOrder_${po.poNumber}`
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
