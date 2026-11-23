import multer from 'multer';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { sendError } from '../utils/response.js';

export const notFound = (req, res, next) => next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));

// Centralised error handler – every error in the app ends up here.
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  let status = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let errors = err.errors;

  if (err instanceof multer.MulterError) {
    status = 400;
    const map = {
      LIMIT_FILE_SIZE: `Image is too large. Max size is ${Math.round(env.maxFileSize / 1024 / 1024)}MB per file`,
      LIMIT_FILE_COUNT: `Too many files. Max ${env.maxPostImages} images allowed`,
      LIMIT_UNEXPECTED_FILE: 'Unexpected file field name',
    };
    message = map[err.code] || err.message;
  } else if (err.name === 'ValidationError' && err.errors) {
    status = 422;
    errors = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    message = errors[0]?.message || 'Validation failed';
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  } else if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0];
    message = field && !['user_1_post_1', 'follower_1_following_1'].includes(field) ? `${field} already exists` : 'Duplicate entry';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Invalid JSON body';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body too large';
  } else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    status = 401;
    message = 'Invalid or expired token';
  }

  if (status >= 500) {
    console.error('[ERROR]', err);
    if (env.isProd) message = 'Internal server error';
  }
  const body = errors ? errors : undefined;
  return sendError(res, status, message, body);
};
