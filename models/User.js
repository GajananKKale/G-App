import mongoose from 'mongoose';
import crypto from 'crypto';
import { hashPassword, comparePassword, sha256 } from '../utils/password.js';
import { absUrl } from '../utils/url.js';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    firstName: { type: String, required: [true, 'First name is required'], trim: true, maxlength: 50 },
    lastName: { type: String, required: [true, 'Last name is required'], trim: true, maxlength: 50 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    mobile: { type: String, required: true, unique: true, trim: true },
    country: { type: String, required: true, trim: true, maxlength: 80 },
    state: { type: String, required: true, trim: true, maxlength: 80 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },

    profilePicture: { type: String, default: '' },
    bio: { type: String, default: '', maxlength: 500 },
    address: { type: String, default: '', maxlength: 300 },
    pincode: { type: String, default: '', maxlength: 10 },
    website: { type: String, default: '', maxlength: 200 },

    isPrivate: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
    blockedReason: { type: String, default: '' },
    blockedAt: { type: Date },

    isEmailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, select: false },
    emailVerificationExpires: { type: Date, select: false },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    passwordChangedAt: { type: Date },
    lastLoginAt: { type: Date },

    followersCount: { type: Number, default: 0, min: 0 },
    followingCount: { type: Number, default: 0, min: 0 },
    postsCount: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.password;
        delete ret.emailVerificationToken;
        delete ret.emailVerificationExpires;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpires;
        if (ret.profilePicture) ret.profilePicture = absUrl(ret.profilePicture);
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

userSchema.virtual('fullName').get(function () {
  return `${this.firstName || ''} ${this.lastName || ''}`.trim();
});

userSchema.index({ role: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ firstName: 1, lastName: 1 });

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await hashPassword(this.password);
  if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000);
});

userSchema.methods.comparePassword = function (candidate) {
  return comparePassword(candidate, this.password);
};

userSchema.methods.createPasswordResetToken = function () {
  const raw = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = sha256(raw);
  this.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000);
  return raw;
};

userSchema.methods.createEmailVerificationToken = function () {
  const raw = crypto.randomBytes(32).toString('hex');
  this.emailVerificationToken = sha256(raw);
  this.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return raw;
};

export default mongoose.model('User', userSchema);
