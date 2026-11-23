import rateLimit from 'express-rate-limit';
import env from '../config/env.js';
import { sendError } from '../utils/response.js';

const handler = (req, res) => sendError(res, 429, 'Too many requests. Please try again later.');

export const apiLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

// stricter limit for login / register / forgot-password (brute force protection)
export const authLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});
