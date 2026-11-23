import User from '../models/User.js';
import TokenBlacklist from '../models/TokenBlacklist.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { signToken } from '../utils/jwt.js';
import { sha256 } from '../utils/password.js';
import env from '../config/env.js';
import {
  sendRegistrationEmail, sendVerificationEmail, sendWelcomeEmail, sendForgotPasswordEmail,
  sendPasswordResetSuccessEmail, sendPasswordChangedEmail,
} from '../services/email.service.js';

// POST /api/auth/register
export const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, mobile, country, state, city } = req.body;

  const [emailTaken, mobileTaken] = await Promise.all([User.exists({ email }), User.exists({ mobile })]);
  if (emailTaken) throw new ApiError(409, 'Email is already registered');
  if (mobileTaken) throw new ApiError(409, 'Mobile number is already registered');

  // role is always "user" – any role sent by the client is ignored
  const user = new User({ firstName, lastName, email, password, mobile, country, state, city, role: 'user' });
  const verifyToken = user.createEmailVerificationToken();
  await user.save();

  sendRegistrationEmail(user, verifyToken); // async, errors are logged only

  const token = signToken(user);
  return sendSuccess(res, {
    status: 201,
    message: 'Registration successful. A confirmation email has been sent.',
    data: { user, token, ...(env.exposeDevTokens ? { devVerificationToken: verifyToken } : {}) },
  });
});

// POST /api/auth/login   body: { email | mobile | identifier, password }
export const login = asyncHandler(async (req, res) => {
  const { email, mobile, identifier, password } = req.body;
  const id = String(email || mobile || identifier).trim();
  const query = id.includes('@') ? { email: id.toLowerCase() } : { mobile: id.replace(/[\s-]/g, '') };

  const user = await User.findOne(query).select('+password');
  if (!user || !(await user.comparePassword(password))) throw new ApiError(401, 'Invalid email/mobile or password');
  if (user.isBlocked) throw new ApiError(403, 'Your account has been blocked. Contact support.');

  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  const token = signToken(user);
  return sendSuccess(res, { message: 'Login successful', data: { user, token, expiresIn: env.jwtExpiresIn } });
});

// POST /api/auth/logout  – revokes the current token
export const logout = asyncHandler(async (req, res) => {
  await TokenBlacklist.updateOne(
    { jti: req.token.jti },
    { $setOnInsert: { jti: req.token.jti, expiresAt: new Date(req.token.exp * 1000) } },
    { upsert: true }
  );
  return sendSuccess(res, { message: 'Logged out successfully' });
});

// GET /api/auth/me
export const getMe = asyncHandler(async (req, res) => sendSuccess(res, { message: 'Logged-in user fetched', data: { user: req.user } }));

// POST /api/auth/forgot-password   body: { email }
export const forgotPassword = asyncHandler(async (req, res) => {
  const generic = 'If an account exists for this email, a password reset link has been sent.';
  const user = await User.findOne({ email: req.body.email });
  if (!user || user.isBlocked) return sendSuccess(res, { message: generic });

  const token = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });
  try {
    await sendForgotPasswordEmail(user, token);
  } catch (err) {
    console.error('[EMAIL ERROR] forgot-password:', err.message);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });
    if (!env.exposeDevTokens) throw new ApiError(500, 'Could not send the reset email. Please try again later.');
  }
  return sendSuccess(res, { message: generic, data: env.exposeDevTokens ? { devResetToken: token } : undefined });
});

// POST /api/auth/reset-password   body: { token, password }   (also accepts /reset-password/:token)
export const resetPassword = asyncHandler(async (req, res) => {
  const token = req.params.token || req.body.token;
  const user = await User.findOne({
    passwordResetToken: sha256(String(token)),
    passwordResetExpires: { $gt: new Date() },
  }).select('+password +passwordResetToken +passwordResetExpires');
  if (!user) throw new ApiError(400, 'Reset token is invalid or has expired');

  user.password = req.body.password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();
  sendPasswordResetSuccessEmail(user);
  return sendSuccess(res, { message: 'Password reset successful. Please log in with your new password.' });
});

// PUT /api/auth/change-password   body: { currentPassword, newPassword }
export const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(req.body.currentPassword))) throw new ApiError(400, 'Current password is incorrect');

  user.password = req.body.newPassword;
  await user.save();

  // revoke the token used for this request, hand out a fresh one
  await TokenBlacklist.updateOne(
    { jti: req.token.jti },
    { $setOnInsert: { jti: req.token.jti, expiresAt: new Date(req.token.exp * 1000) } },
    { upsert: true }
  );
  sendPasswordChangedEmail(user);
  return sendSuccess(res, { message: 'Password changed successfully', data: { token: signToken(user) } });
});

// GET /api/auth/verify-email/:token
export const verifyEmail = asyncHandler(async (req, res) => {
  const user = await User.findOne({
    emailVerificationToken: sha256(String(req.params.token)),
    emailVerificationExpires: { $gt: new Date() },
  }).select('+emailVerificationToken +emailVerificationExpires');

  if (!user) {
    return res.format({
      html: () => res.status(400).send('<h2>Verification link is invalid or has expired.</h2>'),
      default: () => res.status(400).json({ success: false, message: 'Verification token is invalid or has expired' }),
    });
  }
  const wasVerified = user.isEmailVerified;
  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save({ validateBeforeSave: false });
  if (!wasVerified) sendWelcomeEmail(user);

  return res.format({
    html: () => res.send('<h2>Email verified successfully ✅ You can now return to the app.</h2>'),
    default: () => res.json({ success: true, message: 'Email verified successfully' }),
  });
});

// POST /api/auth/resend-verification
export const resendVerification = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user.isEmailVerified) throw new ApiError(400, 'Email is already verified');
  const token = user.createEmailVerificationToken();
  await user.save({ validateBeforeSave: false });
  sendVerificationEmail(user, token);
  return sendSuccess(res, {
    message: 'Verification email sent',
    data: env.exposeDevTokens ? { devVerificationToken: token } : undefined,
  });
});
