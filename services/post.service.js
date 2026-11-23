import Post from '../models/Post.js';
import Comment from '../models/Comment.js';
import CommentLike from '../models/CommentLike.js';
import Reaction from '../models/Reaction.js';
import SavedPost from '../models/SavedPost.js';
import Notification from '../models/Notification.js';
import Report from '../models/Report.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import { incUser, parseList } from '../utils/counters.js';
import { removeUploadedFiles } from '../utils/files.js';
import { saveImages } from './storage.service.js';
import { withTransaction } from '../utils/transaction.js';
import { assertAccess } from './visibility.service.js';
import { AUTHOR_FIELDS } from './serializer.service.js';

// Stores the uploaded post images (Cloudinary or local disk) and returns [{ url, filename }].
export const storePostImages = (files = []) => saveImages(files, 'posts');

/** Loads a post and makes sure `viewer` is allowed to see it (hidden / blocked / private rules). */
export const loadPostForViewer = async (postId, viewer) => {
  const post = await Post.findById(postId).populate('author', AUTHOR_FIELDS);
  if (!post || !post.author) throw new ApiError(404, 'Post not found');
  const isOwner = String(post.author._id) === String(viewer._id);
  if (post.isHidden && !isOwner && viewer.role !== 'admin') throw new ApiError(404, 'Post not found');
  await assertAccess(viewer, post.author, { notFoundMessage: 'Post not found' });
  return post;
};

/** Applies caption / location / image changes from a multipart or JSON request to a post document. */
export const applyPostUpdate = async (post, req) => {
  const files = req.files || [];
  const { caption, location } = req.body;

  const toRemove = new Set(parseList(req.body.removeImages));
  const removed = post.images.filter((i) => toRemove.has(i.filename) || toRemove.has(String(i._id)));
  const kept = post.images.filter((i) => !removed.includes(i));
  const finalCount = kept.length + files.length;
  // validate BEFORE uploading anything
  if (finalCount < 1) throw new ApiError(400, 'A post must keep at least one image');
  if (finalCount > env.maxPostImages) throw new ApiError(400, `A post can have at most ${env.maxPostImages} images`);

  let newImages = [];
  try {
    newImages = await storePostImages(files);
    if (caption !== undefined) post.caption = caption;
    if (location !== undefined) post.location = location;
    post.images = [...kept, ...newImages];
    await post.save();
  } catch (err) {
    await removeUploadedFiles(newImages.map((i) => i.url)); // roll back the new uploads
    throw err;
  }
  await removeUploadedFiles(removed.map((i) => i.url));
  return post;
};

/** Deletes a post together with everything that hangs off it (comments, reactions, saves, reports, notifications, files). */
export const deletePostCascade = async (post) => {
  await withTransaction(async (session) => {
    const commentIds = await Comment.distinct('_id', { post: post._id }).session(session);
    await CommentLike.deleteMany({ comment: { $in: commentIds } }, { session });
    await Comment.deleteMany({ post: post._id }, { session });
    await Reaction.deleteMany({ post: post._id }, { session });
    await SavedPost.deleteMany({ post: post._id }, { session });
    await Report.deleteMany({ post: post._id }, { session });
    await Notification.deleteMany({ post: post._id }, { session });
    await Post.deleteOne({ _id: post._id }, { session });
    await incUser(post.author?._id || post.author, 'postsCount', -1, session);
  });
  await removeUploadedFiles(post.images.map((i) => i.url));
};
