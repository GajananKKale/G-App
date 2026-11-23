import Comment from '../models/Comment.js';
import CommentLike from '../models/CommentLike.js';
import Post from '../models/Post.js';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { getPagination, buildMeta } from '../utils/pagination.js';
import { loadPostForViewer } from '../services/post.service.js';
import { deleteCommentCascade } from '../services/comment.service.js';
import { getBlockRelatedIds } from '../services/visibility.service.js';
import { BRIEF_USER_FIELDS, serializeComments } from '../services/serializer.service.js';
import { notify, removeNotification } from '../services/notification.service.js';

const populateAuthor = (q) => q.populate('author', BRIEF_USER_FIELDS);

// Creates a comment on a post (parent optional -> reply). Replies are flat: replying to a reply attaches to the top-level comment.
const createComment = async (req, postId, parentId) => {
  const post = await loadPostForViewer(postId, req.user);
  let parent = null;
  if (parentId) {
    parent = await Comment.findById(parentId);
    if (!parent || String(parent.post) !== String(post._id) || parent.isHidden) throw new ApiError(404, 'Parent comment not found on this post');
    if (parent.parentComment) parent = await Comment.findById(parent.parentComment);
    if (!parent) throw new ApiError(404, 'Parent comment not found on this post');
  }
  const replyTarget = parentId ? await Comment.findById(parentId) : null;

  const comment = await Comment.create({
    post: post._id,
    author: req.user._id,
    text: req.body.text,
    parentComment: parent ? parent._id : null,
  });
  await Post.updateOne({ _id: post._id }, { $inc: { commentsCount: 1 } });
  if (parent) await Comment.updateOne({ _id: parent._id }, { $inc: { repliesCount: 1 } });

  if (replyTarget) {
    await notify({ recipient: replyTarget.author, sender: req.user, type: 'reply', post: post._id, comment: comment._id });
  }
  if (!replyTarget || String(post.author._id) !== String(replyTarget.author)) {
    await notify({ recipient: post.author._id, sender: req.user, type: 'comment', post: post._id, comment: comment._id });
  }
  return comment;
};

// POST /api/posts/:postId/comments   body: { text, parentComment? }
export const addComment = asyncHandler(async (req, res) => {
  const comment = await createComment(req, req.params.postId, req.body.parentComment);
  await comment.populate('author', BRIEF_USER_FIELDS);
  const [out] = await serializeComments([comment], req.user._id);
  return sendSuccess(res, { status: 201, message: req.body.parentComment ? 'Reply added' : 'Comment added', data: { comment: out } });
});

// POST /api/comments/:id/replies   body: { text }
export const addReply = asyncHandler(async (req, res) => {
  const parent = await Comment.findById(req.params.id);
  if (!parent) throw new ApiError(404, 'Comment not found');
  const comment = await createComment(req, parent.post, parent._id);
  await comment.populate('author', BRIEF_USER_FIELDS);
  const [out] = await serializeComments([comment], req.user._id);
  return sendSuccess(res, { status: 201, message: 'Reply added', data: { comment: out } });
});

const listComments = async (req, res, baseFilter, message, defaultSort) => {
  const pg = getPagination(req, { defaultLimit: 10 });
  const blockedIds = await getBlockRelatedIds(req.user._id);
  const hiddenUsers = await User.distinct('_id', { isBlocked: true });
  const filter = { ...baseFilter, isHidden: false, author: { $nin: [...blockedIds, ...hiddenUsers] } };
  const sort = req.query.sort === 'oldest' ? { createdAt: 1, _id: 1 } : req.query.sort === 'newest' ? { createdAt: -1, _id: -1 } : defaultSort;
  const [comments, total] = await Promise.all([
    populateAuthor(Comment.find(filter).sort(sort).skip(pg.skip).limit(pg.limit)),
    Comment.countDocuments(filter),
  ]);
  return sendSuccess(res, { message, data: { comments: await serializeComments(comments, req.user._id) }, meta: buildMeta(pg, total) });
};

// GET /api/posts/:postId/comments?sort=newest|oldest  – top-level comments (each has repliesCount)
export const getComments = asyncHandler(async (req, res) => {
  const post = await loadPostForViewer(req.params.postId, req.user);
  return listComments(req, res, { post: post._id, parentComment: null }, 'Comments fetched', { createdAt: -1, _id: -1 });
});

// GET /api/comments/:id/replies
export const getReplies = asyncHandler(async (req, res) => {
  const parent = await Comment.findById(req.params.id);
  if (!parent) throw new ApiError(404, 'Comment not found');
  await loadPostForViewer(parent.post, req.user);
  return listComments(req, res, { parentComment: parent._id }, 'Replies fetched', { createdAt: 1, _id: 1 });
});

// PUT /api/comments/:id   – own comment only
export const updateComment = asyncHandler(async (req, res) => {
  const comment = await Comment.findById(req.params.id);
  if (!comment) throw new ApiError(404, 'Comment not found');
  if (String(comment.author) !== String(req.user._id)) throw new ApiError(403, 'You can only edit your own comments');
  comment.text = req.body.text;
  comment.isEdited = true;
  await comment.save();
  await comment.populate('author', BRIEF_USER_FIELDS);
  const [out] = await serializeComments([comment], req.user._id);
  return sendSuccess(res, { message: 'Comment updated', data: { comment: out } });
});

// DELETE /api/comments/:id  – owner or admin
export const deleteComment = asyncHandler(async (req, res) => {
  const comment = await Comment.findById(req.params.id);
  if (!comment) throw new ApiError(404, 'Comment not found');
  if (String(comment.author) !== String(req.user._id) && req.user.role !== 'admin') {
    throw new ApiError(403, 'You can only delete your own comments');
  }
  await deleteCommentCascade(comment);
  return sendSuccess(res, { message: 'Comment deleted' });
});

// POST /api/comments/:id/like
export const likeComment = asyncHandler(async (req, res) => {
  const comment = await Comment.findById(req.params.id);
  if (!comment || comment.isHidden) throw new ApiError(404, 'Comment not found');
  await loadPostForViewer(comment.post, req.user);
  let created = true;
  try {
    await CommentLike.create({ user: req.user._id, comment: comment._id });
  } catch (err) {
    if (err.code !== 11000) throw err;
    created = false;
  }
  if (created) {
    await Comment.updateOne({ _id: comment._id }, { $inc: { likesCount: 1 } });
    await notify({ recipient: comment.author, sender: req.user, type: 'comment_like', post: comment.post, comment: comment._id });
  }
  const fresh = await Comment.findById(comment._id).select('likesCount');
  return sendSuccess(res, { message: created ? 'Comment liked' : 'You already liked this comment', data: { likesCount: fresh.likesCount, isLiked: true } });
});

// DELETE /api/comments/:id/like
export const unlikeComment = asyncHandler(async (req, res) => {
  const comment = await Comment.findById(req.params.id);
  if (!comment) throw new ApiError(404, 'Comment not found');
  const removed = await CommentLike.findOneAndDelete({ user: req.user._id, comment: comment._id });
  if (removed) {
    await Comment.updateOne({ _id: comment._id, likesCount: { $gt: 0 } }, { $inc: { likesCount: -1 } });
    await removeNotification({ recipient: comment.author, sender: req.user._id, type: 'comment_like', comment: comment._id });
  }
  const fresh = await Comment.findById(comment._id).select('likesCount');
  return sendSuccess(res, { message: removed ? 'Comment like removed' : 'You have not liked this comment', data: { likesCount: fresh.likesCount, isLiked: false } });
});
