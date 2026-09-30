import PDFDocument from 'pdfkit';
import { Response } from 'express';

export interface PDFDocumentData {
  title: string;
  docNumber: string;
  issueDate?: string | Date;
  dueDate?: string | Date | null;
  status?: string;
  currency?: string;
  company: {
    name: string;
    legalName?: string | null;
    email?: string | null;
    phone?: string | null;
    website?: string | null;
    address?: string | null;
    taxId?: string | null;
    logoUrl?: string | null;
    bankName?: string | null;
    accountName?: string | null;
    accountNumber?: string | null;
    routingNumber?: string | null;
    branchName?: string | null;
  };
  recipient: {
    name: string;
    contactPerson?: string | null;
    email?: string | null;
    phone?: string | null;
    taxId?: string | null;
    address?: string | null;
  };
  recipientLabel?: string; // "BILL TO" or "VENDOR"
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    amount: number;
  }>;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  notes?: string | null;
  paymentMethod?: string | null;
}

export function generatePDFStream(res: Response, data: PDFDocumentData, filename: string) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  // Set response headers for PDF download/inline display
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}.pdf"`);

  doc.pipe(res);

  const primaryColor = '#0f172a'; // Slate 900
  const accentColor = '#2563eb'; // Primary Blue
  const lightBg = '#f8fafc'; // Slate 50
  const textColor = '#334155'; // Slate 700

  const currencySymbol = data.currency || 'USD';

  // --- HEADER SECTION ---
  doc.fillColor(primaryColor).fontSize(20).font('Helvetica-Bold').text(data.company.name, 40, 40);

  if (data.company.legalName) {
    doc.fontSize(9).font('Helvetica').fillColor('#64748b').text(data.company.legalName, 40, 65);
  }

  const companyDetails = [
    data.company.address,
    [data.company.email, data.company.phone].filter(Boolean).join(' | '),
    data.company.taxId ? `Tax ID: ${data.company.taxId}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  doc.fontSize(8.5).font('Helvetica').fillColor('#64748b').text(companyDetails, 40, 80, { width: 260 });

  // --- RIGHT TITLE & METADATA BANNER ---
  doc.fillColor(accentColor).fontSize(18).font('Helvetica-Bold').text(data.title.toUpperCase(), 320, 40, { align: 'right' });

  doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text(`# ${data.docNumber}`, 320, 65, { align: 'right' });

  const formatDate = (d?: string | Date | null) => {
    if (!d) return 'N/A';
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  let metaY = 82;
  doc.fontSize(8.5).font('Helvetica').fillColor('#475569');
  doc.text(`Issue Date: ${formatDate(data.issueDate)}`, 320, metaY, { align: 'right' });
  if (data.dueDate) {
    metaY += 14;
    doc.text(`Due / Expiry Date: ${formatDate(data.dueDate)}`, 320, metaY, { align: 'right' });
  }
  if (data.status) {
    metaY += 14;
    doc.text(`Status: ${data.status}`, 320, metaY, { align: 'right' });
  }

  // Divider Line
  doc.moveTo(40, 140).lineTo(555, 140).strokeColor('#e2e8f0').lineWidth(1).stroke();

  // --- RECIPIENT / BILL TO SECTION ---
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#94a3b8').text((data.recipientLabel || 'BILL TO').toUpperCase(), 40, 150);
  doc.fontSize(11).font('Helvetica-Bold').fillColor(primaryColor).text(data.recipient.name, 40, 164);

  const recipientInfo = [
    data.recipient.contactPerson ? `Attn: ${data.recipient.contactPerson}` : '',
    data.recipient.address,
    [data.recipient.email, data.recipient.phone].filter(Boolean).join(' | '),
    data.recipient.taxId ? `Tax ID: ${data.recipient.taxId}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  doc.fontSize(8.5).font('Helvetica').fillColor(textColor).text(recipientInfo, 40, 178, { width: 300 });

  // --- TABLE HEADER ---
  let tableTop = 240;

  doc.rect(40, tableTop, 515, 22).fill(lightBg);

  doc.fillColor('#475569').fontSize(8.5).font('Helvetica-Bold');
  doc.text('#', 48, tableTop + 6, { width: 20 });
  doc.text('Description', 70, tableTop + 6, { width: 230 });
  doc.text('Qty', 300, tableTop + 6, { width: 40, align: 'right' });
  doc.text('Unit Price', 350, tableTop + 6, { width: 70, align: 'right' });
  doc.text('Tax %', 430, tableTop + 6, { width: 40, align: 'right' });
  doc.text('Amount', 480, tableTop + 6, { width: 70, align: 'right' });

  // --- TABLE ROWS ---
  let y = tableTop + 26;
  doc.font('Helvetica').fontSize(8.5);

  data.items.forEach((item, index) => {
    if (y > 700) {
      doc.addPage({ margin: 40, size: 'A4' });
      y = 50;
    }

    doc.fillColor(textColor);
    doc.text(String(index + 1), 48, y, { width: 20 });
    doc.text(item.description, 70, y, { width: 230 });
    doc.text(String(item.quantity), 300, y, { width: 40, align: 'right' });
    doc.text(`${item.unitPrice.toFixed(2)}`, 350, y, { width: 70, align: 'right' });
    doc.text(`${item.taxRate}%`, 430, y, { width: 40, align: 'right' });
    doc.text(`${item.amount.toFixed(2)}`, 480, y, { width: 70, align: 'right' });

    y += 20;
    doc.moveTo(40, y - 4).lineTo(555, y - 4).strokeColor('#f1f5f9').lineWidth(0.5).stroke();
  });

  // --- TOTALS SECTION ---
  y += 10;
  if (y > 680) {
    doc.addPage({ margin: 40, size: 'A4' });
    y = 50;
  }

  const totalsX = 350;
  const totalsWidth = 205;

  doc.fontSize(9).font('Helvetica').fillColor('#475569');
  doc.text('Subtotal:', totalsX, y, { width: 100 });
  doc.text(`${currencySymbol} ${data.subtotal.toFixed(2)}`, totalsX + 100, y, { width: totalsWidth - 100, align: 'right' });

  y += 16;
  doc.text('Tax Amount:', totalsX, y, { width: 100 });
  doc.text(`${currencySymbol} ${data.taxAmount.toFixed(2)}`, totalsX + 100, y, { width: totalsWidth - 100, align: 'right' });

  y += 18;
  doc.rect(totalsX - 5, y - 4, totalsWidth + 10, 24).fill('#eff6ff');
  doc.fillColor(accentColor).fontSize(11).font('Helvetica-Bold');
  doc.text('Total Amount:', totalsX, y, { width: 100 });
  doc.text(`${currencySymbol} ${data.totalAmount.toFixed(2)}`, totalsX + 100, y, { width: totalsWidth - 100, align: 'right' });

  // --- BANK & PAYMENT DETAILS SECTION ---
  y += 35;
  if (data.company.bankName || data.company.accountNumber) {
    if (y > 700) {
      doc.addPage({ margin: 40, size: 'A4' });
      y = 50;
    }

    doc.fontSize(9).font('Helvetica-Bold').fillColor(primaryColor).text('BANK PAYMENT WIRE DETAILS', 40, y);
    y += 14;

    const bankDetails = [
      data.company.bankName ? `Bank Name: ${data.company.bankName}` : '',
      data.company.accountName ? `Account Name: ${data.company.accountName}` : '',
      data.company.accountNumber ? `Account Number: ${data.company.accountNumber}` : '',
      data.company.routingNumber ? `SWIFT / IFSC / Routing: ${data.company.routingNumber}` : '',
      data.company.branchName ? `Branch: ${data.company.branchName}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    doc.fontSize(8.5).font('Helvetica').fillColor(textColor).text(bankDetails, 40, y, { width: 300 });
  }

  // --- NOTES SECTION ---
  if (data.notes) {
    y += 60;
    if (y > 720) {
      doc.addPage({ margin: 40, size: 'A4' });
      y = 50;
    }
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#64748b').text('NOTES / TERMS:', 40, y);
    doc.fontSize(8).font('Helvetica').fillColor('#64748b').text(data.notes, 40, y + 12, { width: 515 });
  }

  // End Document
  doc.end();
}
