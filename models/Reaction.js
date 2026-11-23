import mongoose from 'mongoose';

const { Schema } = mongoose;

const reactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    post: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    type: { type: String, enum: ['like', 'dislike'], required: true },
  },
  { timestamps: true, versionKey: false }
);

reactionSchema.index({ user: 1, post: 1 }, { unique: true }); // one reaction per user per post
reactionSchema.index({ post: 1, type: 1, createdAt: -1 });

export default mongoose.model('Reaction', reactionSchema);
