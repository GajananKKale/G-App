import User from '../models/User.js';
import Post from '../models/Post.js';
import Block from '../models/Block.js';
import SavedPost from '../models/SavedPost.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { getPagination, buildMeta } from '../utils/pagination.js';
import { escapeRegex } from '../utils/counters.js';
import { removeUploadedFile } from '../utils/files.js';
import { saveImages } from '../services/storage.service.js';
import { sendVerificationEmail } from '../services/email.service.js';
import { acceptAllPending, removeFollowBetween } from '../services/follow.service.js';
import {
  getAccess, getBlockRelatedIds, getFollowStatus, buildVisiblePostFilter,
} from '../services/visibility.service.js';
import {
  AUTHOR_FIELDS, serializePosts, toPublicUser, attachFollowStatus,
} from '../services/serializer.service.js';

export const targetUserId = (req) => (req.params.id === 'me' ? String(req.user._id) : req.params.id);

const EDITABLE = ['firstName', 'lastName', 'email', 'mobile', 'country', 'state', 'city', 'bio', 'address', 'pincode', 'website', 'isPrivate'];

// Shared by the user and admin "update profile" endpoints. `role`, `isBlocked`, counters etc. can never be set here.
export const applyProfileUpdates = async (user, body) => {
  if (body.email !== undefined && body.email !== user.email) {
    if (await User.exists({ email: body.email, _id: { $ne: user._id } })) throw new ApiError(409, 'Email is already registered');
  }
  if (body.mobile !== undefined && body.mobile !== user.mobile) {
    if (await User.exists({ mobile: body.mobile, _id: { $ne: user._id } })) throw new ApiError(409, 'Mobile number is already registered');
  }
  const emailChanged = body.email !== undefined && body.email !== user.email;
  const wasPrivate = user.isPrivate;
  for (const f of EDITABLE) if (body[f] !== undefined) user[f] = body[f];
  let verifyToken;
  if (emailChanged) {
    user.isEmailVerified = false;
    verifyToken = user.createEmailVerificationToken();
  }
  await user.save();
  if (wasPrivate && user.isPrivate === false) await acceptAllPending(user);
  if (verifyToken) sendVerificationEmail(user, verifyToken);
  return user;
};

// GET /api/users/me
export const getMyProfile = asyncHandler(async (req, res) =>
  sendSuccess(res, { message: 'Profile fetched', data: { user: req.user } })
);

// PUT /api/users/me
export const updateMyProfile = asyncHandler(async (req, res) => {
  const user = await applyProfileUpdates(req.user, req.body);
  return sendSuccess(res, { message: 'Profile updated successfully', data: { user } });
});

// PUT|POST /api/users/me/profile-image   (multipart field: profileImage)
export const uploadProfileImage = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'Please upload an image using the "profileImage" field');
  const [image] = await saveImages([req.file], 'profiles');
  const old = req.user.profilePicture;
  req.user.profilePicture = image.url;
  try {
    await req.user.save();
  } catch (err) {
    await removeUploadedFile(image.url);
    throw err;
  }
  await removeUploadedFile(old);
  return sendSuccess(res, { message: 'Profile picture updated', data: { user: req.user } });
});

// DELETE /api/users/me/profile-image
export const removeProfileImage = asyncHandler(async (req, res) => {
  const old = req.user.profilePicture;
  req.user.profilePicture = '';
  await req.user.save();
  await removeUploadedFile(old);
  return sendSuccess(res, { message: 'Profile picture removed', data: { user: req.user } });
});

// GET /api/users/:id  (id or "me")
export const getUserProfile = asyncHandler(async (req, res) => {
  const id = targetUserId(req);
  const isMe = id === String(req.user._id);
  const target = isMe ? req.user : await User.findById(id);
  if (!target) throw new ApiError(404, 'User not found');

  const access = await getAccess(req.user, target);
  if (access === 'notfound') throw new ApiError(404, 'User not found');

  const profile = isMe ? target.toJSON() : req.user.role === 'admin' ? target.toJSON() : toPublicUser(target);
  const [followStatus, followedBy, blockedByMe] = isMe
    ? ['none', false, false]
    : await Promise.all([
        getFollowStatus(req.user._id, target._id),
        getFollowStatus(target._id, req.user._id).then((s) => s === 'accepted'),
        Block.exists({ blocker: req.user._id, blocked: target._id }).then(Boolean),
      ]);

  return sendSuccess(res, {
    message: 'User profile fetched',
    data: {
      user: {
        ...profile,
        isMe,
        followStatus, // 'none' | 'pending' | 'accepted'
        isFollowing: followStatus === 'accepted',
        isFollowedBy: followedBy,
        isBlockedByMe: blockedByMe,
        isLocked: access === 'private', // private account and viewer does not follow -> posts hidden
      },
    },
  });
});

// GET /api/users/:id/posts  (id or "me")  also /api/posts/user/:userId
export const getUserPosts = asyncHandler(async (req, res) => {
  const id = req.params.id === 'me' ? String(req.user._id) : req.params.id || req.params.userId;
  const isMe = id === String(req.user._id);
  const target = isMe ? req.user : await User.findById(id);
  if (!target) throw new ApiError(404, 'User not found');
  const access = await getAccess(req.user, target);
  if (access === 'notfound') throw new ApiError(404, 'User not found');
  if (access === 'private') throw new ApiError(403, 'This account is private. Follow this user to see their posts.');

  const pg = getPagination(req);
  const filter = { author: target._id };
  if (!isMe && req.user.role !== 'admin') filter.isHidden = false; // owners still see their own moderated posts
  const [posts, total] = await Promise.all([
    Post.find(filter).sort({ createdAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit).populate('author', AUTHOR_FIELDS),
    Post.countDocuments(filter),
  ]);
  return sendSuccess(res, {
    message: 'Posts fetched',
    data: { posts: await serializePosts(posts, req.user._id) },
    meta: buildMeta(pg, total),
  });
});

// GET /api/users/search?q=
export const searchUsers = asyncHandler(async (req, res) => {
  const tokens = String(req.query.q).trim().split(/\s+/).slice(0, 5);
  const blockedIds = await getBlockRelatedIds(req.user._id);
  const filter = {
    _id: { $nin: [req.user._id, ...blockedIds] },
    isBlocked: false,
    $and: tokens.map((t) => {
      const rx = new RegExp(escapeRegex(t), 'i');
      return { $or: [{ firstName: rx }, { lastName: rx }] };
    }),
  };
  const pg = getPagination(req);
  const [users, total] = await Promise.all([
    User.find(filter).sort({ firstName: 1, lastName: 1 }).skip(pg.skip).limit(pg.limit),
    User.countDocuments(filter),
  ]);
  const list = await attachFollowStatus(users.map(toPublicUser), req.user._id);
  return sendSuccess(res, { message: 'Users fetched', data: { users: list }, meta: buildMeta(pg, total) });
});

// GET /api/users/me/saved
export const getSavedPosts = asyncHandler(async (req, res) => {
  const pg = getPagination(req);
  const [saved, total] = await Promise.all([
    SavedPost.find({ user: req.user._id }).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit),
    SavedPost.countDocuments({ user: req.user._id }),
  ]);
  const visible = await buildVisiblePostFilter(req.user);
  const posts = await Post.find({ ...visible, _id: { $in: saved.map((s) => s.post) } }).populate('author', AUTHOR_FIELDS);
  const order = new Map(saved.map((s, i) => [String(s.post), i]));
  posts.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));
  return sendSuccess(res, {
    message: 'Saved posts fetched',
    data: { posts: await serializePosts(posts, req.user._id) },
    meta: buildMeta(pg, total),
  });
});

// POST /api/users/:id/block
export const blockUser = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (id === String(req.user._id)) throw new ApiError(400, 'You cannot block yourself');
  const target = await User.findById(id);
  if (!target) throw new ApiError(404, 'User not found');
  if (target.role === 'admin') throw new ApiError(403, 'Admin accounts cannot be blocked');
  try {
    await Block.create({ blocker: req.user._id, blocked: target._id });
  } catch (err) {
    if (err.code !== 11000) throw err; // already blocked -> idempotent
  }
  await removeFollowBetween(req.user._id, target._id);
  return sendSuccess(res, { message: 'User blocked' });
});

// DELETE /api/users/:id/block
export const unblockUser = asyncHandler(async (req, res) => {
  const result = await Block.deleteOne({ blocker: req.user._id, blocked: req.params.id });
  return sendSuccess(res, { message: result.deletedCount ? 'User unblocked' : 'User was not blocked' });
});

// GET /api/users/me/blocked
export const getBlockedUsers = asyncHandler(async (req, res) => {
  const pg = getPagination(req);
  const [rows, total] = await Promise.all([
    Block.find({ blocker: req.user._id }).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).populate('blocked'),
    Block.countDocuments({ blocker: req.user._id }),
  ]);
  const users = rows.filter((r) => r.blocked).map((r) => ({ ...toPublicUser(r.blocked), blockedAt: r.createdAt }));
  return sendSuccess(res, { message: 'Blocked users fetched', data: { users }, meta: buildMeta(pg, total) });
});
