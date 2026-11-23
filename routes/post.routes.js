import { Router } from 'express';
import * as p from '../controllers/post.controller.js';
import * as r from '../controllers/reaction.controller.js';
import * as cm from '../controllers/comment.controller.js';
import { getUserPosts } from '../controllers/user.controller.js';
import { protect } from '../middlewares/auth.js';
import { uploadPostImages } from '../middlewares/upload.js';
import validate from '../middlewares/validate.js';
import { idParam, paginationRules } from '../validators/common.js';
import { createPostRules, updatePostRules, postSearchRules, reportRules } from '../validators/post.validator.js';
import { commentRules } from '../validators/comment.validator.js';

const router = Router();
router.use(protect);

router.get('/', paginationRules, validate, p.getAllPosts);
router.post('/', uploadPostImages, createPostRules, validate, p.createPost);
router.get('/search', postSearchRules, paginationRules, validate, p.searchPosts);
router.get('/user/:userId', idParam('userId'), paginationRules, validate, getUserPosts);

router.get('/:id', idParam(), validate, p.getPost);
router.put('/:id', idParam(), uploadPostImages, updatePostRules, validate, p.updatePost);
router.delete('/:id', idParam(), validate, p.deletePost);

// reactions
router.post('/:id/like', idParam(), validate, r.likePost);
router.delete('/:id/like', idParam(), validate, r.unlikePost);
router.post('/:id/dislike', idParam(), validate, r.dislikePost);
router.delete('/:id/dislike', idParam(), validate, r.removeDislike);
router.get('/:id/reactions', idParam(), paginationRules, validate, p.getPostReactions);

// comments
router.get('/:postId/comments', idParam('postId'), paginationRules, validate, cm.getComments);
router.post('/:postId/comments', idParam('postId'), commentRules, validate, cm.addComment);

// extras
router.post('/:id/save', idParam(), validate, p.savePost);
router.delete('/:id/save', idParam(), validate, p.unsavePost);
router.post('/:id/share', idParam(), validate, p.sharePost);
router.post('/:id/report', idParam(), reportRules, validate, p.reportPost);

export default router;
