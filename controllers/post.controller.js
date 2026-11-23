import Post from '../models/Post.js';
import SavedPost from '../models/SavedPost.js';
import Report from '../models/Report.js';
import Reaction from '../models/Reaction.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { getPagination, buildMeta } from '../utils/pagination.js';
import { escapeRegex, incUser } from '../utils/counters.js';
import { removeUploadedFiles } from '../utils/files.js';
import { buildVisiblePostFilter, getFollowingIds } from '../services/visibility.service.js';
import { AUTHOR_FIELDS, serializePost, serializePosts, toPublicUser, attachFollowStatus } from '../services/serializer.service.js';
import { storePostImages, loadPostForViewer, applyPostUpdate, deletePostCascade } from '../services/post.service.js';

const populateAuthor = (q) => q.populate('author', AUTHOR_FIELDS);

// POST /api/posts  (multipart: images[], caption, location)
export const createPost = asyncHandler(async (req, res) => {
  if (!req.files?.length) throw new ApiError(400, 'Please upload at least one image using the "images" field');
  const images = await storePostImages(req.files);
  try {
    const post = await Post.create({
      author: req.user._id,
      caption: req.body.caption || '',
      location: req.body.location || '',
      images,
    });
    await incUser(req.user._id, 'postsCount', 1);
    await post.populate('author', AUTHOR_FIELDS);
    return sendSuccess(res, { status: 201, message: 'Post created successfully', data: { post: await serializePost(post, req.user._id) } });
  } catch (err) {
    await removeUploadedFiles(images.map((i) => i.url));
    throw err;
  }
});

const listPosts = (message, { onlyFollowing = false } = {}) =>
  asyncHandler(async (req, res) => {
    const pg = getPagination(req);
    const filter = await buildVisiblePostFilter(req.user);
    if (onlyFollowing || req.query.following === 'true') {
      const ids = await getFollowingIds(req.user._id);
      const allowed = [req.user._id, ...ids].map(String);
      const nin = new Set((filter.author?.$nin || []).map(String));
      filter.author = { $in: allowed.filter((a) => !nin.has(a)) };
    }
    const [posts, total] = await Promise.all([
      populateAuthor(Post.find(filter).sort({ createdAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit)),
      Post.countDocuments(filter),
    ]);
    return sendSuccess(res, { message, data: { posts: await serializePosts(posts, req.user._id) }, meta: buildMeta(pg, total) });
  });

// GET /api/posts   – all posts visible to the user, latest first, paginated
export const getAllPosts = listPosts('Posts fetched');
// GET /api/feed    – same as above (?following=true limits to people you follow + yourself)
export const getFeed = listPosts('Feed fetched');

// GET /api/posts/search?q=
export const searchPosts = asyncHandler(async (req, res) => {
  const pg = getPagination(req);
  const filter = { ...(await buildVisiblePostFilter(req.user)), caption: new RegExp(escapeRegex(String(req.query.q).trim()), 'i') };
  const [posts, total] = await Promise.all([
    populateAuthor(Post.find(filter).sort({ createdAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit)),
    Post.countDocuments(filter),
  ]);
  return sendSuccess(res, { message: 'Posts fetched', data: { posts: await serializePosts(posts, req.user._id) }, meta: buildMeta(pg, total) });
});

// GET /api/posts/:id
export const getPost = asyncHandler(async (req, res) => {
  const post = await loadPostForViewer(req.params.id, req.user);
  return sendSuccess(res, { message: 'Post fetched', data: { post: await serializePost(post, req.user._id) } });
});

// PUT /api/posts/:id  (multipart: images[] to add, removeImages = filenames/ids to remove, caption, location)
export const updatePost = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id).populate('author', AUTHOR_FIELDS);
  if (!post) throw new ApiError(404, 'Post not found');
  if (String(post.author._id) !== String(req.user._id)) throw new ApiError(403, 'You can only edit your own posts');
  await applyPostUpdate(post, req);
  return sendSuccess(res, { message: 'Post updated successfully', data: { post: await serializePost(post, req.user._id) } });
});

// DELETE /api/posts/:id  – owner or admin
export const deletePost = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) throw new ApiError(404, 'Post not found');
  if (String(post.author) !== String(req.user._id) && req.user.role !== 'admin') {
    throw new ApiError(403, 'You can only delete your own posts');
  }
  await deletePostCascade(post);
  return sendSuccess(res, { message: 'Post deleted successfully' });
});

// POST /api/posts/:id/save
export const savePost = asyncHandler(async (req, res) => {
  const post = await loadPostForViewer(req.params.id, req.user);
  try {
    await SavedPost.create({ user: req.user._id, post: post._id });
  } catch (err) {
    if (err.code !== 11000) throw err; // already saved -> idempotent
  }
  return sendSuccess(res, { message: 'Post saved', data: { isSaved: true } });
});

// DELETE /api/posts/:id/save
export const unsavePost = asyncHandler(async (req, res) => {
  await SavedPost.deleteOne({ user: req.user._id, post: req.params.id });
  return sendSuccess(res, { message: 'Post removed from saved', data: { isSaved: false } });
});

// POST /api/posts/:id/share  – returns a shareable link and counts the share
export const sharePost = asyncHandler(async (req, res) => {
  const post = await loadPostForViewer(req.params.id, req.user);
  const updated = await Post.findByIdAndUpdate(post._id, { $inc: { sharesCount: 1 } }, { returnDocument: 'after' }).select('sharesCount');
  return sendSuccess(res, {
    message: 'Post share link generated',
    data: { shareUrl: `${env.clientUrl}/posts/${post._id}`, apiUrl: `${env.baseUrl}/api/posts/${post._id}`, sharesCount: updated.sharesCount },
  });
});

// POST /api/posts/:id/report
export const reportPost = asyncHandler(async (req, res) => {
  const post = await loadPostForViewer(req.params.id, req.user);
  if (String(post.author._id) === String(req.user._id)) throw new ApiError(400, 'You cannot report your own post');
  await Report.create({ post: post._id, reporter: req.user._id, reason: req.body.reason, description: req.body.description || '' });
  await Post.updateOne({ _id: post._id }, { $inc: { reportsCount: 1 } });
  return sendSuccess(res, { status: 201, message: 'Post reported. Our team will review it.' });
});

// GET /api/posts/:id/likes?type=like|dislike  – who reacted
export const getPostReactions = asyncHandler(async (req, res) => {
  const post = await loadPostForViewer(req.params.id, req.user);
  const type = req.query.type === 'dislike' ? 'dislike' : 'like';
  const pg = getPagination(req);
  const filter = { post: post._id, type };
  const [rows, total] = await Promise.all([
    Reaction.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).populate('user'),
    Reaction.countDocuments(filter),
  ]);
  const users = await attachFollowStatus(rows.filter((r) => r.user && !r.user.isBlocked).map((r) => toPublicUser(r.user)), req.user._id);
  return sendSuccess(res, { message: 'Reactions fetched', data: { users }, meta: buildMeta(pg, total) });
});
