import mongoose from 'mongoose';
import { absUrl } from '../utils/url.js';

const { Schema } = mongoose;

const imageSchema = new Schema({ url: { type: String, required: true }, filename: { type: String, required: true } });

const postSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    caption: { type: String, default: '', trim: true, maxlength: 2200 },
    location: { type: String, default: '', trim: true, maxlength: 150 },
    images: { type: [imageSchema], validate: [(v) => v.length >= 1 && v.length <= 10, 'A post needs 1 to 10 images'] },

    likesCount: { type: Number, default: 0, min: 0 },
    dislikesCount: { type: Number, default: 0, min: 0 },
    commentsCount: { type: Number, default: 0, min: 0 },
    sharesCount: { type: Number, default: 0, min: 0 },
    reportsCount: { type: Number, default: 0, min: 0 },

    // moderation
    isHidden: { type: Boolean, default: false },
    hiddenReason: { type: String, default: '' },
    hiddenBy: { type: Schema.Types.ObjectId, ref: 'User' },
    hiddenAt: { type: Date },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        if (Array.isArray(ret.images)) ret.images = ret.images.map((i) => ({ ...i, url: absUrl(i.url) }));
        return ret;
      },
    },
  }
);

postSchema.index({ createdAt: -1 });
postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ isHidden: 1, createdAt: -1 });

export default mongoose.model('Post', postSchema);
