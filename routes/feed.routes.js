import { Router } from 'express';
import { getFeed } from '../controllers/post.controller.js';
import { protect } from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import { paginationRules } from '../validators/common.js';

const router = Router();
router.get('/', protect, paginationRules, validate, getFeed);
export default router;
