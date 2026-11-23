import Reaction from '../models/Reaction.js';
import SavedPost from '../models/SavedPost.js';
import CommentLike from '../models/CommentLike.js';
import Follow from '../models/Follow.js';

export const AUTHOR_FIELDS = 'firstName lastName profilePicture isPrivate isBlocked';
export const BRIEF_USER_FIELDS = 'firstName lastName profilePicture isPrivate';

const stripAuthor = (o) => {
  if (o.author && typeof o.author === 'object') delete o.author.isBlocked;
  return o;
};

// Adds viewer specific flags (reaction / saved) to post documents (author must be populated).
export const serializePosts = async (posts, viewerId) => {
  if (!posts.length) return [];
  const ids = posts.map((p) => p._id);
  const [reactions, saved] = await Promise.all([
    Reaction.find({ user: viewerId, post: { $in: ids } }).select('post type'),
    SavedPost.find({ user: viewerId, post: { $in: ids } }).select('post'),
  ]);
  const rmap = new Map(reactions.map((r) => [String(r.post), r.type]));
  const smap = new Set(saved.map((s) => String(s.post)));
  return posts.map((p) => {
    const o = stripAuthor(p.toJSON());
    const reaction = rmap.get(String(p._id)) || null;
    o.reaction = reaction; // 'like' | 'dislike' | null
    o.isLiked = reaction === 'like';
    o.isDisliked = reaction === 'dislike';
    o.isSaved = smap.has(String(p._id));
    return o;
  });
};

export const serializePost = async (post, viewerId) => (await serializePosts([post], viewerId))[0];

export const serializeComments = async (comments, viewerId) => {
  if (!comments.length) return [];
  const likes = await CommentLike.find({ user: viewerId, comment: { $in: comments.map((c) => c._id) } }).select('comment');
  const liked = new Set(likes.map((l) => String(l.comment)));
  return comments.map((c) => {
    const o = c.toJSON();
    o.isLiked = liked.has(String(c._id));
    return o;
  });
};

const PUBLIC_KEYS = [
  '_id', 'id', 'firstName', 'lastName', 'fullName', 'profilePicture', 'bio', 'country', 'state', 'city',
  'website', 'isPrivate', 'followersCount', 'followingCount', 'postsCount', 'createdAt',
];

// What other users are allowed to see of a profile (no email / mobile / address / role...).
export const toPublicUser = (user) => {
  const o = typeof user.toJSON === 'function' ? user.toJSON() : user;
  const out = {};
  for (const k of PUBLIC_KEYS) if (o[k] !== undefined) out[k] = o[k];
  return out;
};

// Adds followStatus ('none' | 'pending' | 'accepted') for the viewer to a list of plain user objects.
export const attachFollowStatus = async (users, viewerId) => {
  if (!users.length) return users;
  const rows = await Follow.find({ follower: viewerId, following: { $in: users.map((u) => u._id) } }).select('following status');
  const map = new Map(rows.map((r) => [String(r.following), r.status]));
  return users.map((u) => {
    const status = map.get(String(u._id)) || 'none';
    return { ...u, followStatus: status, isFollowing: status === 'accepted', isMe: String(u._id) === String(viewerId) };
  });
};
