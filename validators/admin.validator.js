import { body } from 'express-validator';

export const roleRules = [body('role').isIn(['user', 'admin']).withMessage('Role must be "user" or "admin"')];
export const blockRules = [body('reason').optional().isString().isLength({ max: 300 }).withMessage('Reason can be at most 300 characters')];
export const reportStatusRules = [
  body('status').isIn(['pending', 'reviewed', 'dismissed', 'action_taken']).withMessage('Status must be pending, reviewed, dismissed or action_taken'),
  body('hidePost').optional().isBoolean().toBoolean(),
];
