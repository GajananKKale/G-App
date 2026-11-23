import User from '../models/User.js';
import Post from '../models/Post.js';
import Comment from '../models/Comment.js';
import CommentLike from '../models/CommentLike.js';
import Reaction from '../models/Reaction.js';
import SavedPost from '../models/SavedPost.js';
import Follow from '../models/Follow.js';
import Block from '../models/Block.js';
import Notification from '../models/Notification.js';
import Report from '../models/Report.js';
import { deletePostCascade } from './post.service.js';
import { removeUploadedFile } from '../utils/files.js';
import { withTransaction } from '../utils/transaction.js';

const groupCount = (items, keyFn) => {
  const map = new Map();
  for (const it of items) {
    const k = String(keyFn(it));
    map.set(k, (map.get(k) || 0) + 1);
  }
  return map;
};

const decrementMany = (Model, map, field) =>
  Promise.all([...map.entries()].map(([id, n]) => Model.updateOne({ _id: id, [field]: { $gte: n } }, { $inc: { [field]: -n } })));

/** Permanently deletes a user and everything they created, keeping all counters consistent. */
export const deleteUserCascade = async (user) => {
  const uid = user._id;

  // 1. their posts (each cascade removes the post's comments / reactions / files)
  const posts = await Post.find({ author: uid });
  for (const p of posts) await deletePostCascade(p);

  // 2. their comments on other people's posts (+ replies under them)
  const myComments = await Comment.find({ author: uid }).select('_id post parentComment');
  const myTopIds = myComments.filter((c) => !c.parentComment).map((c) => c._id);
  const repliesToMine = await Comment.find({ parentComment: { $in: myTopIds }, author: { $ne: uid } }).select('_id post');
  const mineIds = new Set(myComments.map((c) => String(c._id)));
  const allComments = [...myComments, ...repliesToMine.filter((r) => !mineIds.has(String(r._id)))];
  const allIds = allComments.map((c) => c._id);

  // comments the user liked
  const likedComments = await CommentLike.find({ user: uid }).select('comment');
  // reactions the user left on posts
  const reactions = await Reaction.find({ user: uid }).select('post type');
  // follow relations
  const follows = await Follow.find({ $or: [{ follower: uid }, { following: uid }], status: 'accepted' }).select('follower following');

  await withTransaction(async (session) => {
    if (allIds.length) {
      await CommentLike.deleteMany({ comment: { $in: allIds } }, { session });
      await Notification.deleteMany({ comment: { $in: allIds } }, { session });
      await Comment.deleteMany({ _id: { $in: allIds } }, { session });
    }
  });
  await decrementMany(Post, groupCount(allComments, (c) => c.post), 'commentsCount');
  // replies of mine under someone else's top-level comment
  const myReplies = myComments.filter((c) => c.parentComment && !myTopIds.some((t) => String(t) === String(c.parentComment)));
  await decrementMany(Comment, groupCount(myReplies, (c) => c.parentComment), 'repliesCount');

  const likedRemaining = likedComments.filter((l) => !allIds.some((i) => String(i) === String(l.comment)));
  await decrementMany(Comment, groupCount(likedRemaining, (l) => l.comment), 'likesCount');
  await CommentLike.deleteMany({ user: uid });

  await decrementMany(Post, groupCount(reactions.filter((r) => r.type === 'like'), (r) => r.post), 'likesCount');
  await decrementMany(Post, groupCount(reactions.filter((r) => r.type === 'dislike'), (r) => r.post), 'dislikesCount');
  await Reaction.deleteMany({ user: uid });

  const followingOthers = follows.filter((f) => String(f.follower) === String(uid));
  const followersOfMe = follows.filter((f) => String(f.following) === String(uid));
  await decrementMany(User, groupCount(followingOthers, (f) => f.following), 'followersCount');
  await decrementMany(User, groupCount(followersOfMe, (f) => f.follower), 'followingCount');
  await Follow.deleteMany({ $or: [{ follower: uid }, { following: uid }] });

  await SavedPost.deleteMany({ user: uid });
  await Block.deleteMany({ $or: [{ blocker: uid }, { blocked: uid }] });
  await Report.deleteMany({ reporter: uid });
  await Notification.deleteMany({ $or: [{ recipient: uid }, { sender: uid }] });

  await removeUploadedFile(user.profilePicture);
  await User.deleteOne({ _id: uid });
};
