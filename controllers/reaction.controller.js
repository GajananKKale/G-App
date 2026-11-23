import Post from '../models/Post.js';
import Reaction from '../models/Reaction.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { loadPostForViewer } from '../services/post.service.js';
import { notify, removeNotification } from '../services/notification.service.js';

const FIELD = { like: 'likesCount', dislike: 'dislikesCount' };

const state = async (postId, userId) => {
  const [post, reaction] = await Promise.all([
    Post.findById(postId).select('likesCount dislikesCount'),
    Reaction.findOne({ user: userId, post: postId }).select('type'),
  ]);
  const r = reaction ? reaction.type : null;
  return {
    postId: String(postId),
    likesCount: post?.likesCount ?? 0,
    dislikesCount: post?.dislikesCount ?? 0,
    reaction: r,
    isLiked: r === 'like',
    isDisliked: r === 'dislike',
  };
};

// One user can only have one reaction per post (unique index user+post). Switching replaces the old one.
const setReaction = (type) =>
  asyncHandler(async (req, res) => {
    const post = await loadPostForViewer(req.params.id, req.user);
    const filter = { user: req.user._id, post: post._id };
    const update = { $set: { type } };

    let prev;
    try {
      prev = await Reaction.findOneAndUpdate(filter, update, { upsert: true, returnDocument: 'before' });
    } catch (err) {
      if (err.code !== 11000) throw err; // concurrent double-tap: the doc exists now, just update it
      prev = await Reaction.findOneAndUpdate(filter, update, { returnDocument: 'before' });
    }

    const inc = {};
    if (!prev) inc[FIELD[type]] = 1;
    else if (prev.type !== type) {
      inc[FIELD[prev.type]] = -1;
      inc[FIELD[type]] = 1;
    }
    if (Object.keys(inc).length) await Post.updateOne({ _id: post._id }, { $inc: inc });

    if (type === 'like' && (!prev || prev.type !== 'like')) {
      await notify({ recipient: post.author._id, sender: req.user, type: 'like', post: post._id });
    } else if (type === 'dislike' && prev?.type === 'like') {
      await removeNotification({ recipient: post.author._id, sender: req.user._id, type: 'like', post: post._id });
    }

    const changed = !prev || prev.type !== type;
    return sendSuccess(res, {
      message: changed ? (type === 'like' ? 'Post liked' : 'Post disliked') : `You already ${type}d this post`,
      data: await state(post._id, req.user._id),
    });
  });

const clearReaction = (type) =>
  asyncHandler(async (req, res) => {
    const post = await loadPostForViewer(req.params.id, req.user);
    const removed = await Reaction.findOneAndDelete({ user: req.user._id, post: post._id, type });
    if (removed) {
      await Post.updateOne({ _id: post._id, [FIELD[type]]: { $gt: 0 } }, { $inc: { [FIELD[type]]: -1 } });
      if (type === 'like') await removeNotification({ recipient: post.author._id, sender: req.user._id, type: 'like', post: post._id });
    }
    return sendSuccess(res, {
      message: removed ? (type === 'like' ? 'Like removed' : 'Dislike removed') : `You have not ${type}d this post`,
      data: await state(post._id, req.user._id),
    });
  });

export const likePost = setReaction('like');
export const unlikePost = clearReaction('like');
export const dislikePost = setReaction('dislike');
export const removeDislike = clearReaction('dislike');
