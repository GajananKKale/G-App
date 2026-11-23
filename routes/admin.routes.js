import { Router } from 'express';
import * as a from '../controllers/admin.controller.js';
import { protect, authorize } from '../middlewares/auth.js';
import { uploadPostImages } from '../middlewares/upload.js';
import { createPost } from '../controllers/post.controller.js';
import validate from '../middlewares/validate.js';
import { idParam, paginationRules } from '../validators/common.js';
import { adminUpdateUserRules } from '../validators/user.validator.js';
import { createPostRules, updatePostRules, moderationRules } from '../validators/post.validator.js';
import { roleRules, blockRules, reportStatusRules } from '../validators/admin.validator.js';

const router = Router();

// EVERY route below needs a valid JWT *and* role === 'admin'. Normal users get 403.
router.use(protect, authorize('admin'));

router.get('/dashboard', a.getDashboard);

// users
router.get('/users', paginationRules, validate, a.listUsers);
router.get('/users/:id', idParam(), validate, a.getUser);
router.put('/users/:id', idParam(), adminUpdateUserRules, validate, a.updateUser);
router.delete('/users/:id', idParam(), validate, a.deleteUser);
router.patch('/users/:id/block', idParam(), blockRules, validate, a.blockUser);
router.patch('/users/:id/unblock', idParam(), validate, a.unblockUser);
router.patch('/users/:id/role', idParam(), roleRules, validate, a.changeRole);
router.get('/users/:id/posts', idParam(), paginationRules, validate, a.getUserPosts);
router.get('/users/:id/followers', idParam(), paginationRules, validate, a.getUserFollowers);
router.get('/users/:id/following', idParam(), paginationRules, validate, a.getUserFollowing);

// posts
router.get('/posts', paginationRules, validate, a.listPosts);
router.post('/posts', uploadPostImages, createPostRules, validate, createPost);
router.get('/posts/:id', idParam(), validate, a.getPost);
router.put('/posts/:id', idParam(), uploadPostImages, updatePostRules, validate, a.updatePost);
router.delete('/posts/:id', idParam(), validate, a.deletePost);
router.patch('/posts/:id/hide', idParam(), moderationRules, validate, a.hidePost);
router.patch('/posts/:id/unhide', idParam(), validate, a.unhidePost);

// comments
router.get('/comments', paginationRules, validate, a.listComments);
router.delete('/comments/:id', idParam(), validate, a.deleteComment);
router.patch('/comments/:id/hide', idParam(), moderationRules, validate, a.hideComment);
router.patch('/comments/:id/unhide', idParam(), validate, a.unhideComment);

// reports of inappropriate posts
router.get('/reports', paginationRules, validate, a.listReports);
router.patch('/reports/:id', idParam(), reportStatusRules, validate, a.updateReport);

export default router;
