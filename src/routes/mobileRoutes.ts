import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import {
  // Mobile Auth & Profile
  mobileRegister,
  mobileLogin,
  mobileVerify2FA,
  mobileGetMe,
  // Mobile Dashboard
  mobileGetDashboard,
  // Mobile Team & Users
  mobileGetUsers,
  mobileCreateUser,
  mobileDeleteUser,
  // Mobile Clients
  mobileGetClients,
  mobileCreateClient,
  mobileDeleteClient,
  // Mobile Vendors
  mobileGetVendors,
  mobileCreateVendor,
  mobileDeleteVendor,
  // Mobile Items
  mobileGetItems,
  mobileCreateItem,
  mobileDeleteItem,
  // Mobile Estimates
  mobileGetEstimates,
  mobileGetEstimateById,
  mobileCreateEstimate,
  mobileConvertEstimateToProforma,
  mobileConvertEstimateToInvoice,
  mobileDeleteEstimate,
  // Mobile Proforma
  mobileGetProformaInvoices,
  mobileGetProformaById,
  mobileCreateProformaInvoice,
  mobileConvertProformaToInvoice,
  mobileDeleteProforma,
  // Mobile Invoices
  mobileGetInvoices,
  mobileGetInvoiceById,
  mobileCreateInvoice,
  mobileUpdateInvoiceStatus,
  mobileDeleteInvoice,
  // Mobile Purchase Orders
  mobileGetPurchaseOrders,
  mobileGetPOById,
  mobileCreatePurchaseOrder,
  mobileUpdatePOStatus,
  mobileDeletePurchaseOrder,
  // Mobile PDF Generation
  mobileGetEstimatePDF,
  mobileGetProformaPDF,
  mobileGetInvoicePDF,
  mobileGetPOPDF,
} from '../controllers/mobileController';

const router = Router();

/**
 * ============================================================================
 * PUBLIC MOBILE AUTH ROUTES
 * ============================================================================
 */
router.post('/auth/register', mobileRegister);
router.post('/auth/login', mobileLogin);
router.post('/auth/verify-2fa', mobileVerify2FA);

/**
 * ============================================================================
 * PROTECTED MOBILE APP ROUTES (Requires Bearer JWT Token & Tenant Context)
 * ============================================================================
 */
router.use(requireAuth as any);

// User & Tenant Context
router.get('/auth/me', mobileGetMe);
router.get('/dashboard', mobileGetDashboard);

// Team & User Management
router.get('/users', mobileGetUsers);
router.post('/users', mobileCreateUser);
router.delete('/users/:id', mobileDeleteUser);

// Clients
router.get('/clients', mobileGetClients);
router.post('/clients', mobileCreateClient);
router.delete('/clients/:id', mobileDeleteClient);

// Vendors
router.get('/vendors', mobileGetVendors);
router.post('/vendors', mobileCreateVendor);
router.delete('/vendors/:id', mobileDeleteVendor);

// Items / Inventory
router.get('/items', mobileGetItems);
router.post('/items', mobileCreateItem);
router.delete('/items/:id', mobileDeleteItem);

// Estimates
router.get('/estimates', mobileGetEstimates);
router.get('/estimates/:id', mobileGetEstimateById);
router.get('/estimates/:id/pdf', mobileGetEstimatePDF);
router.post('/estimates', mobileCreateEstimate);
router.post('/estimates/:id/convert-proforma', mobileConvertEstimateToProforma);
router.post('/estimates/:id/convert-invoice', mobileConvertEstimateToInvoice);
router.delete('/estimates/:id', mobileDeleteEstimate);

// Proforma Invoices
router.get('/proforma', mobileGetProformaInvoices);
router.get('/proforma/:id', mobileGetProformaById);
router.get('/proforma/:id/pdf', mobileGetProformaPDF);
router.post('/proforma', mobileCreateProformaInvoice);
router.post('/proforma/:id/convert-invoice', mobileConvertProformaToInvoice);
router.delete('/proforma/:id', mobileDeleteProforma);

// Tax Invoices
router.get('/invoices', mobileGetInvoices);
router.get('/invoices/:id', mobileGetInvoiceById);
router.get('/invoices/:id/pdf', mobileGetInvoicePDF);
router.post('/invoices', mobileCreateInvoice);
router.patch('/invoices/:id/status', mobileUpdateInvoiceStatus);
router.delete('/invoices/:id', mobileDeleteInvoice);

// Purchase Orders
router.get('/purchase-orders', mobileGetPurchaseOrders);
router.get('/purchase-orders/:id', mobileGetPOById);
router.get('/purchase-orders/:id/pdf', mobileGetPOPDF);
router.post('/purchase-orders', mobileCreatePurchaseOrder);
router.patch('/purchase-orders/:id/status', mobileUpdatePOStatus);
router.delete('/purchase-orders/:id', mobileDeletePurchaseOrder);

export default router;
