import { body } from 'express-validator';

export const commentRules = [
  body('text').isString().withMessage('Comment text is required').trim().isLength({ min: 1, max: 1000 }).withMessage('Comment must be 1-1000 characters'),
  body('parentComment').optional({ values: 'falsy' }).isMongoId().withMessage('Invalid parentComment id'),
];

export const updateCommentRules = [
  body('text').isString().withMessage('Comment text is required').trim().isLength({ min: 1, max: 1000 }).withMessage('Comment must be 1-1000 characters'),
];
