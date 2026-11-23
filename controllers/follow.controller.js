import User from '../models/User.js';
import Follow from '../models/Follow.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { getPagination, buildMeta } from '../utils/pagination.js';
import { createFollow, removeFollow, acceptFollowRequest } from '../services/follow.service.js';
import { assertAccess, getAccess, getFollowStatus } from '../services/visibility.service.js';
import { toPublicUser, attachFollowStatus } from '../services/serializer.service.js';
import { targetUserId } from './user.controller.js';

const counts = (u) => ({ followersCount: u.followersCount, followingCount: u.followingCount });

// POST /api/users/:id/follow
export const followUser = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (id === String(req.user._id)) throw new ApiError(400, 'You cannot follow yourself');
  const target = await User.findById(id);
  if (!target) throw new ApiError(404, 'User not found');
  const access = await getAccess(req.user, target);
  if (access === 'notfound') throw new ApiError(404, 'User not found');

  const existing = await Follow.findOne({ follower: req.user._id, following: id });
  if (existing) {
    throw new ApiError(409, existing.status === 'pending' ? 'Follow request already sent' : 'You already follow this user');
  }
  const status = await createFollow(req.user, target);
  const fresh = await User.findById(id).select('followersCount followingCount');
  return sendSuccess(res, {
    status: 201,
    message: status === 'pending' ? 'Follow request sent' : 'User followed successfully',
    data: { followStatus: status, isFollowing: status === 'accepted', ...counts(fresh) },
  });
});

// DELETE /api/users/:id/follow   (also cancels a pending request)
export const unfollowUser = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (id === String(req.user._id)) throw new ApiError(400, 'You cannot unfollow yourself');
  const removed = await removeFollow(req.user._id, id);
  if (!removed) throw new ApiError(404, 'You are not following this user');
  const fresh = await User.findById(id).select('followersCount followingCount');
  return sendSuccess(res, {
    message: removed.status === 'pending' ? 'Follow request cancelled' : 'User unfollowed successfully',
    data: { followStatus: 'none', isFollowing: false, ...(fresh ? counts(fresh) : {}) },
  });
});

// GET /api/users/:id/follow-status
export const checkFollowStatus = asyncHandler(async (req, res) => {
  const id = targetUserId(req);
  const [status, followedBy] = await Promise.all([
    getFollowStatus(req.user._id, id),
    getFollowStatus(id, req.user._id),
  ]);
  return sendSuccess(res, {
    message: 'Follow status fetched',
    data: { followStatus: status, isFollowing: status === 'accepted', isFollowedBy: followedBy === 'accepted' },
  });
});

const listRelation = (field, otherField) =>
  asyncHandler(async (req, res) => {
    const id = targetUserId(req);
    const target = id === String(req.user._id) ? req.user : await User.findById(id);
    if (!target) throw new ApiError(404, 'User not found');
    await assertAccess(req.user, target);

    const pg = getPagination(req);
    const filter = { [field]: target._id, status: 'accepted' };
    const [rows, total] = await Promise.all([
      Follow.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).populate(otherField),
      Follow.countDocuments(filter),
    ]);
    const users = await attachFollowStatus(rows.filter((r) => r[otherField]).map((r) => toPublicUser(r[otherField])), req.user._id);
    return sendSuccess(res, {
      message: `${field === 'following' ? 'Followers' : 'Following'} fetched`,
      data: { users, total },
      meta: buildMeta(pg, total),
    });
  });

// GET /api/users/:id/followers
export const getFollowers = listRelation('following', 'follower');
// GET /api/users/:id/following
export const getFollowing = listRelation('follower', 'following');

// GET /api/users/me/follow-requests  (pending requests for my private account)
export const getFollowRequests = asyncHandler(async (req, res) => {
  const pg = getPagination(req);
  const filter = { following: req.user._id, status: 'pending' };
  const [rows, total] = await Promise.all([
    Follow.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).populate('follower'),
    Follow.countDocuments(filter),
  ]);
  const users = rows.filter((r) => r.follower).map((r) => ({ ...toPublicUser(r.follower), requestedAt: r.createdAt }));
  return sendSuccess(res, { message: 'Follow requests fetched', data: { users }, meta: buildMeta(pg, total) });
});

// POST /api/users/me/follow-requests/:userId/accept
export const acceptRequest = asyncHandler(async (req, res) => {
  const follower = await User.findById(req.params.userId);
  if (!follower) throw new ApiError(404, 'User not found');
  const accepted = await acceptFollowRequest(req.user, follower);
  if (!accepted) throw new ApiError(404, 'No pending follow request from this user');
  const fresh = await User.findById(req.user._id).select('followersCount followingCount');
  return sendSuccess(res, { message: 'Follow request accepted', data: counts(fresh) });
});

// POST /api/users/me/follow-requests/:userId/reject
export const rejectRequest = asyncHandler(async (req, res) => {
  const row = await Follow.findOneAndDelete({ follower: req.params.userId, following: req.user._id, status: 'pending' });
  if (!row) throw new ApiError(404, 'No pending follow request from this user');
  return sendSuccess(res, { message: 'Follow request rejected' });
});

// DELETE /api/users/me/followers/:userId  – remove somebody from my followers
export const removeFollower = asyncHandler(async (req, res) => {
  const removed = await removeFollow(req.params.userId, req.user._id);
  if (!removed) throw new ApiError(404, 'This user is not following you');
  return sendSuccess(res, { message: 'Follower removed' });
});
