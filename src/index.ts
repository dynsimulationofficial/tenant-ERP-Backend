import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { authMiddleware } from './middleware/authMiddleware';

import authRoutes from './routes/authRoutes';
import tenantRoutes from './routes/tenantRoutes';
import clientRoutes from './routes/clientRoutes';
import vendorRoutes from './routes/vendorRoutes';
import itemRoutes from './routes/itemRoutes';
import estimateRoutes from './routes/estimateRoutes';
import proformaRoutes from './routes/proformaRoutes';
import invoiceRoutes from './routes/invoiceRoutes';
import purchaseOrderRoutes from './routes/purchaseOrderRoutes';
import userRoutes from './routes/userRoutes';
import mobileRoutes from './routes/mobileRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 2000;

// Configure CORS to explicitly allow custom x-tenant-id and Authorization headers
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'],
  })
);

app.use(express.json());

// Auth & Tenant Context Middleware
app.use(authMiddleware as any);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/users', userRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/estimates', estimateRoutes);
app.use('/api/proforma', proformaRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/mobile', mobileRoutes);

// Root route aliases for convenience
app.use('/auth', authRoutes);
app.use('/mobile', mobileRoutes);

app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    message: 'TenantERP Express MVC Backend is Live and Operational',
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'TenantERP Express MVC Backend Operational' });
});

app.listen(PORT, () => {
  console.log(`🚀 TenantERP Express Backend running on http://localhost:${PORT}`);
});
