import { Router } from 'express';
import {
  getEstimates,
  getEstimateById,
  getEstimatePDF,
  createEstimate,
  convertEstimateToProforma,
  convertEstimateToInvoice,
  deleteEstimate,
} from '../controllers/estimateController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

router.use(requireAuth as any);

router.get('/', getEstimates);
router.get('/:id', getEstimateById);
router.get('/:id/pdf', getEstimatePDF);
router.post('/', createEstimate);
router.post('/:id/convert-proforma', convertEstimateToProforma);
router.post('/:id/convert-invoice', convertEstimateToInvoice);
router.delete('/:id', deleteEstimate);

export default router;
