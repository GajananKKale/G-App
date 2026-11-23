import User from '../models/User.js';
import TokenBlacklist from '../models/TokenBlacklist.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { verifyToken } from '../utils/jwt.js';

// Requires a valid, non-revoked JWT and an active account. Sets req.user and req.token.
export const protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) throw new ApiError(401, 'Authentication required. Please log in.');
  const raw = header.slice(7).trim();
  if (!raw) throw new ApiError(401, 'Authentication required. Please log in.');

  let decoded;
  try {
    decoded = verifyToken(raw);
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new ApiError(401, 'Token expired. Please log in again.');
    throw new ApiError(401, 'Invalid token. Please log in again.');
  }

  if (await TokenBlacklist.exists({ jti: decoded.jti })) {
    throw new ApiError(401, 'Token is no longer valid. Please log in again.');
  }

  const user = await User.findById(decoded.id);
  if (!user) throw new ApiError(401, 'The account for this token no longer exists.');
  if (user.isBlocked) throw new ApiError(403, 'Your account has been blocked. Contact support.');
  if (user.passwordChangedAt && Math.floor(user.passwordChangedAt.getTime() / 1000) > decoded.iat) {
    throw new ApiError(401, 'Password was changed recently. Please log in again.');
  }

  req.user = user;
  req.token = decoded;
  next();
});

// Role based authorization. Must be used after protect.
export const authorize =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'Authentication required.'));
    if (!roles.includes(req.user.role)) return next(new ApiError(403, 'You do not have permission to perform this action.'));
    next();
  };

export const adminOnly = [protect, authorize('admin')];
