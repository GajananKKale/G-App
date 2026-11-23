import mongoose from 'mongoose';

const { Schema } = mongoose;

const commentLikeSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    comment: { type: Schema.Types.ObjectId, ref: 'Comment', required: true },
  },
  { timestamps: true, versionKey: false }
);

commentLikeSchema.index({ user: 1, comment: 1 }, { unique: true });
commentLikeSchema.index({ comment: 1 });

export default mongoose.model('CommentLike', commentLikeSchema);
