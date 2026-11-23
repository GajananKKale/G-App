import { body } from 'express-validator';
import { nameRule, placeRule, emailRule, mobileRule, passwordRule } from './common.js';

export const registerRules = [
  nameRule('firstName', 'First name'),
  nameRule('lastName', 'Last name'),
  emailRule(),
  passwordRule('password', 'Password'),
  mobileRule('mobile'),
  placeRule('country', 'Country'),
  placeRule('state', 'State'),
  placeRule('city', 'City'),
];

export const loginRules = [
  body('password').isString().withMessage('Password is required').notEmpty().withMessage('Password is required'),
  body('email').optional({ values: 'falsy' }).isString().trim().toLowerCase().isEmail().withMessage('Please provide a valid email'),
  body('mobile').optional({ values: 'falsy' }).isString().customSanitizer((v) => String(v).replace(/[\s-]/g, '')),
  body('identifier').optional({ values: 'falsy' }).isString().trim(),
  body().custom((_, { req }) => {
    const b = req.body;
    if (!b.email && !b.mobile && !b.identifier) throw new Error('Email or mobile number is required');
    return true;
  }),
];

export const forgotPasswordRules = [emailRule()];

export const resetPasswordRules = [
  body('token').isString().withMessage('Reset token is required').notEmpty().withMessage('Reset token is required'),
  passwordRule('password', 'New password'),
];

export const changePasswordRules = [
  body('currentPassword').isString().withMessage('Current password is required').notEmpty().withMessage('Current password is required'),
  passwordRule('newPassword', 'New password'),
  body('newPassword').custom((v, { req }) => {
    if (v === req.body.currentPassword) throw new Error('New password must be different from the current password');
    return true;
  }),
];
