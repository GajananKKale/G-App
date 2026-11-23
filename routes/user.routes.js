import { Router } from 'express';
import * as u from '../controllers/user.controller.js';
import * as f from '../controllers/follow.controller.js';
import { protect } from '../middlewares/auth.js';
import { uploadProfileImage } from '../middlewares/upload.js';
import validate from '../middlewares/validate.js';
import { idParam, userIdParam, paginationRules } from '../validators/common.js';
import { updateProfileRules, searchRules } from '../validators/user.validator.js';

const router = Router();
router.use(protect);

// ---- me / static routes first (must be declared before "/:id") ----
router.get('/search', searchRules, paginationRules, validate, u.searchUsers);
router.get('/me', u.getMyProfile);
router.put('/me', updateProfileRules, validate, u.updateMyProfile);
router.put('/me/profile-image', uploadProfileImage, u.uploadProfileImage);
router.post('/me/profile-image', uploadProfileImage, u.uploadProfileImage);
router.delete('/me/profile-image', u.removeProfileImage);
router.get('/me/saved', paginationRules, validate, u.getSavedPosts);
router.get('/me/blocked', paginationRules, validate, u.getBlockedUsers);
router.get('/me/follow-requests', paginationRules, validate, f.getFollowRequests);
router.post('/me/follow-requests/:userId/accept', idParam('userId'), validate, f.acceptRequest);
router.post('/me/follow-requests/:userId/reject', idParam('userId'), validate, f.rejectRequest);
router.delete('/me/followers/:userId', idParam('userId'), validate, f.removeFollower);

// ---- other users ("me" is accepted as id for read endpoints) ----
router.get('/:id', userIdParam(), validate, u.getUserProfile);
router.get('/:id/posts', userIdParam(), paginationRules, validate, u.getUserPosts);
router.get('/:id/followers', userIdParam(), paginationRules, validate, f.getFollowers);
router.get('/:id/following', userIdParam(), paginationRules, validate, f.getFollowing);
router.get('/:id/follow-status', userIdParam(), validate, f.checkFollowStatus);
router.post('/:id/follow', idParam(), validate, f.followUser);
router.delete('/:id/follow', idParam(), validate, f.unfollowUser);
router.post('/:id/block', idParam(), validate, u.blockUser);
router.delete('/:id/block', idParam(), validate, u.unblockUser);

export default router;
