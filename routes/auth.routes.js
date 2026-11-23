import { Router } from 'express';
import * as c from '../controllers/auth.controller.js';
import { protect } from '../middlewares/auth.js';
import { authLimiter } from '../middlewares/rateLimit.js';
import validate from '../middlewares/validate.js';
import { registerRules, loginRules, forgotPasswordRules, resetPasswordRules, changePasswordRules } from '../validators/auth.validator.js';

const router = Router();

router.post('/register', authLimiter, registerRules, validate, c.register);
router.post('/login', authLimiter, loginRules, validate, c.login);
router.post('/logout', protect, c.logout);
router.get('/me', protect, c.getMe);
router.post('/forgot-password', authLimiter, forgotPasswordRules, validate, c.forgotPassword);
router.post('/reset-password', authLimiter, resetPasswordRules, validate, c.resetPassword);
router.post('/reset-password/:token', authLimiter, resetPasswordRules.slice(1), validate, c.resetPassword);
router.put('/change-password', protect, changePasswordRules, validate, c.changePassword);
router.get('/verify-email/:token', c.verifyEmail);
router.post('/resend-verification', protect, c.resendVerification);

export default router;
