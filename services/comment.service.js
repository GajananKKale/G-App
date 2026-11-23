import Comment from '../models/Comment.js';
import CommentLike from '../models/CommentLike.js';
import Notification from '../models/Notification.js';
import Post from '../models/Post.js';
import { withTransaction } from '../utils/transaction.js';

// Deletes a comment (and its replies, likes, notifications) and fixes post / parent counters.
export const deleteCommentCascade = async (comment) => {
  await withTransaction(async (session) => {
    const replyIds = await Comment.distinct('_id', { parentComment: comment._id }).session(session);
    const allIds = [comment._id, ...replyIds];
    await CommentLike.deleteMany({ comment: { $in: allIds } }, { session });
    await Notification.deleteMany({ comment: { $in: allIds } }, { session });
    await Comment.deleteMany({ _id: { $in: allIds } }, { session });
    await Post.updateOne({ _id: comment.post, commentsCount: { $gte: allIds.length } }, { $inc: { commentsCount: -allIds.length } }, { session });
    if (comment.parentComment) {
      await Comment.updateOne({ _id: comment.parentComment, repliesCount: { $gt: 0 } }, { $inc: { repliesCount: -1 } }, { session });
    }
  });
};
