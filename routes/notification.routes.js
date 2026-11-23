import { Router } from 'express';
import * as n from '../controllers/notification.controller.js';
import { protect } from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import { idParam, paginationRules } from '../validators/common.js';

const router = Router();
router.use(protect);

router.get('/', paginationRules, validate, n.getNotifications);
router.get('/unread-count', n.getUnreadCount);
router.patch('/read-all', n.markAllRead);
router.patch('/:id/read', idParam(), validate, n.markRead);
router.delete('/:id', idParam(), validate, n.deleteNotification);

export default router;
