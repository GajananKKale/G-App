import mongoose from 'mongoose';

const { Schema } = mongoose;

export const REPORT_REASONS = ['spam', 'nudity', 'harassment', 'hate_speech', 'violence', 'false_information', 'other'];

const reportSchema = new Schema(
  {
    post: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    description: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: ['pending', 'reviewed', 'dismissed', 'action_taken'], default: 'pending' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  { timestamps: true, versionKey: false, toJSON: { virtuals: true } }
);

reportSchema.index({ post: 1, reporter: 1 }, { unique: true });
reportSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('Report', reportSchema);
