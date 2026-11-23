import { body, query } from 'express-validator';
import { nameRule, placeRule, emailRule, mobileRule, profileFieldRules, passwordRule } from './common.js';

export const updateProfileRules = [
  nameRule('firstName', 'First name', true),
  nameRule('lastName', 'Last name', true),
  emailRule(true),
  mobileRule('mobile', true),
  placeRule('country', 'Country', true),
  placeRule('state', 'State', true),
  placeRule('city', 'City', true),
  ...profileFieldRules,
];

export const searchRules = [
  query('q').isString().withMessage('Search query "q" is required').trim().isLength({ min: 1, max: 100 }).withMessage('Search query "q" is required'),
];

// admin can update the same fields + reset the password and verification flag
export const adminUpdateUserRules = [
  ...updateProfileRules,
  body('isEmailVerified').optional().isBoolean().toBoolean(),
  passwordRule('password', 'Password').optional(),
];
