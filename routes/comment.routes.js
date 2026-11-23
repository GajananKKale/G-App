import { Router } from 'express';
import * as c from '../controllers/comment.controller.js';
import { protect } from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import { idParam, paginationRules } from '../validators/common.js';
import { updateCommentRules, commentRules } from '../validators/comment.validator.js';

const router = Router();
router.use(protect);

router.put('/:id', idParam(), updateCommentRules, validate, c.updateComment);
router.delete('/:id', idParam(), validate, c.deleteComment);
router.get('/:id/replies', idParam(), paginationRules, validate, c.getReplies);
router.post('/:id/replies', idParam(), commentRules.slice(0, 1), validate, c.addReply);
router.post('/:id/like', idParam(), validate, c.likeComment);
router.delete('/:id/like', idParam(), validate, c.unlikeComment);

export default router;
