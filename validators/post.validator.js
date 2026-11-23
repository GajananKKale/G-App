import { body, query } from 'express-validator';

export const createPostRules = [
  body('caption').optional().isString().withMessage('Caption must be text').isLength({ max: 2200 }).withMessage('Caption can be at most 2200 characters'),
  body('location').optional().isString().withMessage('Location must be text').isLength({ max: 150 }).withMessage('Location can be at most 150 characters'),
];

export const updatePostRules = createPostRules;

export const postSearchRules = [
  query('q').isString().withMessage('Search query "q" is required').trim().isLength({ min: 1, max: 100 }).withMessage('Search query "q" is required'),
];

export const reportRules = [
  body('reason').isIn(['spam', 'nudity', 'harassment', 'hate_speech', 'violence', 'false_information', 'other']).withMessage(
    'Reason must be one of: spam, nudity, harassment, hate_speech, violence, false_information, other'
  ),
  body('description').optional().isString().isLength({ max: 500 }).withMessage('Description can be at most 500 characters'),
];

export const moderationRules = [body('reason').optional().isString().isLength({ max: 300 })];
