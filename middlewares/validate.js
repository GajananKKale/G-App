import { validationResult } from 'express-validator';
import ApiError from '../utils/ApiError.js';

export default function validate(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  // uploads are only kept in memory until the controller stores them, so nothing needs cleaning here
  const errors = result.array({ onlyFirstError: true }).map((e) => ({ field: e.path, message: e.msg }));
  next(new ApiError(422, errors[0].message, errors));
}
