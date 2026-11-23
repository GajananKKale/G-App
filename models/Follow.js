import mongoose from 'mongoose';

const { Schema } = mongoose;

const followSchema = new Schema(
  {
    follower: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    following: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted'], default: 'accepted' },
  },
  { timestamps: true, versionKey: false, toJSON: { virtuals: true } }
);

followSchema.index({ follower: 1, following: 1 }, { unique: true }); // prevents duplicate follows
followSchema.index({ following: 1, status: 1, createdAt: -1 });
followSchema.index({ follower: 1, status: 1, createdAt: -1 });

export default mongoose.model('Follow', followSchema);
