import User from '../models/User.js';
import Post from '../models/Post.js';
import Comment from '../models/Comment.js';
import Reaction from '../models/Reaction.js';
import Follow from '../models/Follow.js';
import Report from '../models/Report.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { getPagination, buildMeta } from '../utils/pagination.js';
import { escapeRegex } from '../utils/counters.js';
import { applyProfileUpdates } from './user.controller.js';
import { deletePostCascade, applyPostUpdate } from '../services/post.service.js';
import { deleteCommentCascade } from '../services/comment.service.js';
import { deleteUserCascade } from '../services/user.service.js';
import { BRIEF_USER_FIELDS, toPublicUser } from '../services/serializer.service.js';

const countAdmins = () => User.countDocuments({ role: 'admin', isBlocked: false });
const mustFind = async (Model, id, label) => {
  const doc = await Model.findById(id);
  if (!doc) throw new ApiError(404, `${label} not found`);
  return doc;
};

/* ------------------------------ DASHBOARD ------------------------------ */
// GET /api/admin/dashboard
export const getDashboard = asyncHandler(async (req, res) => {
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [totalUsers, totalAdmins, blockedUsers, totalPosts, hiddenPosts, totalComments, totalLikes, totalDislikes, totalFollowers, pendingReports, newUsersLast7Days, newPostsLast7Days] =
    await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ isBlocked: true }),
      Post.countDocuments(),
      Post.countDocuments({ isHidden: true }),
      Comment.countDocuments(),
      Reaction.countDocuments({ type: 'like' }),
      Reaction.countDocuments({ type: 'dislike' }),
      Follow.countDocuments({ status: 'accepted' }),
      Report.countDocuments({ status: 'pending' }),
      User.countDocuments({ createdAt: { $gte: week } }),
      Post.countDocuments({ createdAt: { $gte: week } }),
    ]);
  return sendSuccess(res, {
    message: 'Dashboard statistics fetched',
    data: {
      stats: {
        totalUsers, totalAdmins, blockedUsers, totalPosts, hiddenPosts, totalComments,
        totalLikes, totalDislikes, totalFollowers, pendingReports, newUsersLast7Days, newPostsLast7Days,
      },
    },
  });
});

/* ------------------------------- USERS ------------------------------- */
// GET /api/admin/users?search=&role=&status=active|blocked&page=&limit=
export const listUsers = asyncHandler(async (req, res) => {
  const pg = getPagination(req, { defaultLimit: 20 });
  const filter = {};
  if (req.query.role === 'admin' || req.query.role === 'user') filter.role = req.query.role;
  if (req.query.status === 'blocked') filter.isBlocked = true;
  if (req.query.status === 'active') filter.isBlocked = false;
  if (req.query.search) {
    const tokens = String(req.query.search).trim().split(/\s+/).slice(0, 5);
    filter.$and = tokens.map((t) => {
      const rx = new RegExp(escapeRegex(t), 'i');
      return { $or: [{ firstName: rx }, { lastName: rx }, { email: rx }, { mobile: rx }] };
    });
  }
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit),
    User.countDocuments(filter),
  ]);
  return sendSuccess(res, { message: 'Users fetched', data: { users }, meta: buildMeta(pg, total) });
});

// GET /api/admin/users/:id
export const getUser = asyncHandler(async (req, res) => {
  const user = await mustFind(User, req.params.id, 'User');
  const commentsCount = await Comment.countDocuments({ author: user._id });
  return sendSuccess(res, { message: 'User fetched', data: { user: { ...user.toJSON(), commentsCount } } });
});

// PUT /api/admin/users/:id
export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('+password');
  if (!user) throw new ApiError(404, 'User not found');
  if (req.body.password) user.password = req.body.password; // hashed by the model
  if (req.body.isEmailVerified !== undefined) user.isEmailVerified = req.body.isEmailVerified;
  await applyProfileUpdates(user, req.body);
  return sendSuccess(res, { message: 'User updated successfully', data: { user } });
});

// DELETE /api/admin/users/:id
export const deleteUser = asyncHandler(async (req, res) => {
  const user = await mustFind(User, req.params.id, 'User');
  if (String(user._id) === String(req.user._id)) throw new ApiError(400, 'You cannot delete your own account here');
  if (user.role === 'admin' && (await countAdmins()) <= 1) throw new ApiError(400, 'Cannot delete the last admin');
  await deleteUserCascade(user);
  return sendSuccess(res, { message: 'User and all related data deleted' });
});

// PATCH /api/admin/users/:id/block   body: { reason? }
export const blockUser = asyncHandler(async (req, res) => {
  const user = await mustFind(User, req.params.id, 'User');
  if (String(user._id) === String(req.user._id)) throw new ApiError(400, 'You cannot block yourself');
  if (user.role === 'admin' && (await countAdmins()) <= 1) throw new ApiError(400, 'Cannot block the last admin');
  user.isBlocked = true;
  user.blockedReason = req.body.reason || '';
  user.blockedAt = new Date();
  await user.save();
  return sendSuccess(res, { message: 'User blocked', data: { user } });
});

// PATCH /api/admin/users/:id/unblock
export const unblockUser = asyncHandler(async (req, res) => {
  const user = await mustFind(User, req.params.id, 'User');
  user.isBlocked = false;
  user.blockedReason = '';
  user.blockedAt = undefined;
  await user.save();
  return sendSuccess(res, { message: 'User unblocked', data: { user } });
});

// PATCH /api/admin/users/:id/role   body: { role: 'user' | 'admin' }
export const changeRole = asyncHandler(async (req, res) => {
  const user = await mustFind(User, req.params.id, 'User');
  const { role } = req.body;
  if (user.role === role) return sendSuccess(res, { message: `User already has role "${role}"`, data: { user } });
  if (String(user._id) === String(req.user._id) && role !== 'admin') throw new ApiError(400, 'You cannot remove your own admin role');
  if (user.role === 'admin' && role === 'user' && (await countAdmins()) <= 1) throw new ApiError(400, 'Cannot demote the last admin');
  user.role = role;
  await user.save();
  return sendSuccess(res, { message: `User role changed to ${role}`, data: { user } });
});

// GET /api/admin/users/:id/posts
export const getUserPosts = asyncHandler(async (req, res) => {
  const user = await mustFind(User, req.params.id, 'User');
  const pg = getPagination(req);
  const filter = { author: user._id };
  const [posts, total] = await Promise.all([
    Post.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).populate('author', BRIEF_USER_FIELDS),
    Post.countDocuments(filter),
  ]);
  return sendSuccess(res, { message: 'User posts fetched', data: { posts }, meta: buildMeta(pg, total) });
});

const relation = (field, otherField, label) =>
  asyncHandler(async (req, res) => {
    const user = await mustFind(User, req.params.id, 'User');
    const pg = getPagination(req, { defaultLimit: 20 });
    const filter = { [field]: user._id, status: 'accepted' };
    const [rows, total] = await Promise.all([
      Follow.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).populate(otherField),
      Follow.countDocuments(filter),
    ]);
    return sendSuccess(res, {
      message: `${label} fetched`,
      data: { users: rows.filter((r) => r[otherField]).map((r) => toPublicUser(r[otherField])), total },
      meta: buildMeta(pg, total),
    });
  });
export const getUserFollowers = relation('following', 'follower', 'Followers');
export const getUserFollowing = relation('follower', 'following', 'Following');

/* ------------------------------- POSTS ------------------------------- */
// GET /api/admin/posts?search=&author=&hidden=true|false&reported=true
export const listPosts = asyncHandler(async (req, res) => {
  const pg = getPagination(req, { defaultLimit: 20 });
  const filter = {};
  if (req.query.search) filter.caption = new RegExp(escapeRegex(String(req.query.search)), 'i');
  if (/^[a-f\d]{24}$/i.test(req.query.author || '')) filter.author = req.query.author;
  if (req.query.hidden === 'true') filter.isHidden = true;
  if (req.query.hidden === 'false') filter.isHidden = false;
  if (req.query.reported === 'true') filter.reportsCount = { $gt: 0 };
  const [posts, total] = await Promise.all([
    Post.find(filter).sort({ createdAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit).populate('author', BRIEF_USER_FIELDS),
    Post.countDocuments(filter),
  ]);
  return sendSuccess(res, { message: 'Posts fetched', data: { posts }, meta: buildMeta(pg, total) });
});

// GET /api/admin/posts/:id
export const getPost = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id).populate('author', BRIEF_USER_FIELDS);
  if (!post) throw new ApiError(404, 'Post not found');
  return sendSuccess(res, { message: 'Post fetched', data: { post } });
});

// PUT /api/admin/posts/:id  (same multipart format as the user endpoint)
export const updatePost = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id).populate('author', BRIEF_USER_FIELDS);
  if (!post) throw new ApiError(404, 'Post not found');
  await applyPostUpdate(post, req);
  return sendSuccess(res, { message: 'Post updated successfully', data: { post } });
});

// DELETE /api/admin/posts/:id
export const deletePost = asyncHandler(async (req, res) => {
  const post = await mustFind(Post, req.params.id, 'Post');
  await deletePostCascade(post);
  return sendSuccess(res, { message: 'Post deleted successfully' });
});

// PATCH /api/admin/posts/:id/hide   body: { reason? }   – moderation: hides an inappropriate post from everyone else
export const hidePost = asyncHandler(async (req, res) => {
  const post = await mustFind(Post, req.params.id, 'Post');
  post.isHidden = true;
  post.hiddenReason = req.body.reason || '';
  post.hiddenBy = req.user._id;
  post.hiddenAt = new Date();
  await post.save();
  return sendSuccess(res, { message: 'Post hidden', data: { post } });
});

// PATCH /api/admin/posts/:id/unhide
export const unhidePost = asyncHandler(async (req, res) => {
  const post = await mustFind(Post, req.params.id, 'Post');
  post.isHidden = false;
  post.hiddenReason = '';
  post.hiddenBy = undefined;
  post.hiddenAt = undefined;
  await post.save();
  return sendSuccess(res, { message: 'Post is visible again', data: { post } });
});

/* ------------------------------ COMMENTS ------------------------------ */
// GET /api/admin/comments?post=&author=&search=&hidden=
export const listComments = asyncHandler(async (req, res) => {
  const pg = getPagination(req, { defaultLimit: 20 });
  const filter = {};
  if (/^[a-f\d]{24}$/i.test(req.query.post || '')) filter.post = req.query.post;
  if (/^[a-f\d]{24}$/i.test(req.query.author || '')) filter.author = req.query.author;
  if (req.query.search) filter.text = new RegExp(escapeRegex(String(req.query.search)), 'i');
  if (req.query.hidden === 'true') filter.isHidden = true;
  if (req.query.hidden === 'false') filter.isHidden = false;
  const [comments, total] = await Promise.all([
    Comment.find(filter).sort({ createdAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit).populate('author', BRIEF_USER_FIELDS),
    Comment.countDocuments(filter),
  ]);
  return sendSuccess(res, { message: 'Comments fetched', data: { comments }, meta: buildMeta(pg, total) });
});

// DELETE /api/admin/comments/:id
export const deleteComment = asyncHandler(async (req, res) => {
  const comment = await mustFind(Comment, req.params.id, 'Comment');
  await deleteCommentCascade(comment);
  return sendSuccess(res, { message: 'Comment deleted' });
});

// PATCH /api/admin/comments/:id/hide | unhide
export const hideComment = asyncHandler(async (req, res) => {
  const comment = await mustFind(Comment, req.params.id, 'Comment');
  comment.isHidden = true;
  comment.hiddenReason = req.body.reason || '';
  comment.hiddenBy = req.user._id;
  await comment.save();
  return sendSuccess(res, { message: 'Comment hidden', data: { comment } });
});
export const unhideComment = asyncHandler(async (req, res) => {
  const comment = await mustFind(Comment, req.params.id, 'Comment');
  comment.isHidden = false;
  comment.hiddenReason = '';
  comment.hiddenBy = undefined;
  await comment.save();
  return sendSuccess(res, { message: 'Comment is visible again', data: { comment } });
});

/* ------------------------------- REPORTS ------------------------------- */
// GET /api/admin/reports?status=pending
export const listReports = asyncHandler(async (req, res) => {
  const pg = getPagination(req, { defaultLimit: 20 });
  const filter = {};
  if (['pending', 'reviewed', 'dismissed', 'action_taken'].includes(req.query.status)) filter.status = req.query.status;
  const [reports, total] = await Promise.all([
    Report.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).populate('reporter', BRIEF_USER_FIELDS).populate('post'),
    Report.countDocuments(filter),
  ]);
  return sendSuccess(res, { message: 'Reports fetched', data: { reports }, meta: buildMeta(pg, total) });
});

// PATCH /api/admin/reports/:id   body: { status, hidePost? }
export const updateReport = asyncHandler(async (req, res) => {
  const report = await mustFind(Report, req.params.id, 'Report');
  report.status = req.body.status;
  report.reviewedBy = req.user._id;
  report.reviewedAt = new Date();
  await report.save();
  if (req.body.hidePost) {
    await Post.updateOne({ _id: report.post }, { $set: { isHidden: true, hiddenReason: `Reported: ${report.reason}`, hiddenBy: req.user._id, hiddenAt: new Date() } });
  }
  return sendSuccess(res, { message: 'Report updated', data: { report } });
});
