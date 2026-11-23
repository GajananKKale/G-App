import mongoose from 'mongoose';

const { Schema } = mongoose;

// Logged-out JWTs. Documents vanish automatically once the token would have expired anyway.
const tokenBlacklistSchema = new Schema(
  {
    jti: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

tokenBlacklistSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('TokenBlacklist', tokenBlacklistSchema);
