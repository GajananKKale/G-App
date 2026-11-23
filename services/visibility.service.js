import User from '../models/User.js';
import Block from '../models/Block.js';
import Follow from '../models/Follow.js';
import ApiError from '../utils/ApiError.js';

// ids of users with a block relation (either direction) with `userId`
export const getBlockRelatedIds = async (userId) => {
  const blocks = await Block.find({ $or: [{ blocker: userId }, { blocked: userId }] }).select('blocker blocked');
  return blocks.map((b) => (String(b.blocker) === String(userId) ? b.blocked : b.blocker));
};

export const getFollowingIds = async (userId) => {
  const rows = await Follow.find({ follower: userId, status: 'accepted' }).select('following');
  return rows.map((r) => r.following);
};

export const isBlockedBetween = async (a, b) => !!(await Block.exists({ $or: [{ blocker: a, blocked: b }, { blocker: b, blocked: a }] }));

export const getFollowStatus = async (viewerId, targetId) => {
  const row = await Follow.findOne({ follower: viewerId, following: targetId }).select('status');
  return row ? row.status : 'none';
};

/**
 * Decides what `viewer` may see of `target`'s content.
 *  'ok'       -> everything
 *  'private'  -> account is private and viewer is not an accepted follower
 *  'notfound' -> hide completely (blocked relation or admin-blocked account)
 */
export const getAccess = async (viewer, target) => {
  if (!target) return 'notfound';
  if (String(viewer._id) === String(target._id) || viewer.role === 'admin') return 'ok';
  if (target.isBlocked) return 'notfound';
  if (await isBlockedBetween(viewer._id, target._id)) return 'notfound';
  if (target.isPrivate) {
    const status = await getFollowStatus(viewer._id, target._id);
    if (status !== 'accepted') return 'private';
  }
  return 'ok';
};

export const assertAccess = async (viewer, target, { notFoundMessage = 'User not found' } = {}) => {
  const access = await getAccess(viewer, target);
  if (access === 'notfound') throw new ApiError(404, notFoundMessage);
  if (access === 'private') throw new ApiError(403, 'This account is private. Follow this user to see their content.');
  return access;
};

/**
 * Mongo filter restricting posts to the ones `viewer` is allowed to see
 * (public accounts, own posts, private accounts they follow; no blocked / admin-blocked authors; no hidden posts).
 */
export const buildVisiblePostFilter = async (viewer) => {
  const filter = { isHidden: false };
  if (viewer.role === 'admin') return filter;
  const [blockedIds, followingIds] = await Promise.all([getBlockRelatedIds(viewer._id), getFollowingIds(viewer._id)]);
  const hiddenAuthors = await User.distinct('_id', {
    _id: { $ne: viewer._id },
    $or: [{ isBlocked: true }, { isPrivate: true, _id: { $nin: followingIds } }],
  });
  filter.author = { $nin: [...blockedIds, ...hiddenAuthors] };
  return filter;
};
