import { body, param, query } from 'express-validator';

export const idParam = (name = 'id') => param(name).isMongoId().withMessage(`Invalid ${name}`);

// like idParam but also accepts the literal "me"
export const userIdParam = (name = 'id') =>
  param(name)
    .custom((v) => v === 'me' || /^[a-f\d]{24}$/i.test(v))
    .withMessage(`Invalid ${name}`);

export const paginationRules = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
];

export const passwordRule = (field = 'password', label = 'Password') =>
  body(field)
    .isString().withMessage(`${label} is required`)
    .isLength({ min: 8, max: 64 }).withMessage(`${label} must be 8-64 characters`)
    .matches(/[A-Za-z]/).withMessage(`${label} must contain at least one letter`)
    .matches(/\d/).withMessage(`${label} must contain at least one number`);

export const nameRule = (field, label, optional = false) => {
  let chain = body(field);
  if (optional) chain = chain.optional();
  return chain
    .isString().withMessage(`${label} is required`)
    .trim()
    .isLength({ min: 1, max: 50 }).withMessage(`${label} is required (max 50 characters)`);
};

export const placeRule = (field, label, optional = false) => {
  let chain = body(field);
  if (optional) chain = chain.optional();
  return chain
    .isString().withMessage(`${label} is required`)
    .trim()
    .isLength({ min: 1, max: 80 }).withMessage(`${label} is required (max 80 characters)`);
};

export const emailRule = (optional = false) => {
  let chain = body('email');
  if (optional) chain = chain.optional();
  return chain
    .isString().withMessage('Email is required')
    .trim()
    .toLowerCase()
    .isEmail().withMessage('Please provide a valid email address');
};

export const mobileRule = (field = 'mobile', optional = false) => {
  let chain = body(field);
  if (optional) chain = chain.optional();
  return chain
    .isString().withMessage('Mobile number is required')
    .customSanitizer((v) => String(v).replace(/[\s-]/g, ''))
    .matches(/^\+?[1-9]\d{6,14}$/).withMessage('Please provide a valid mobile number (7-15 digits, optional + prefix)');
};

export const profileFieldRules = [
  body('bio').optional().isString().isLength({ max: 500 }).withMessage('Bio can be at most 500 characters'),
  body('address').optional().isString().isLength({ max: 300 }).withMessage('Address can be at most 300 characters'),
  body('pincode')
    .optional({ values: 'falsy' })
    .isString().trim()
    .matches(/^[A-Za-z0-9 -]{3,10}$/).withMessage('Please provide a valid pincode'),
  body('website')
    .optional({ values: 'falsy' })
    .isString().trim()
    .isURL({ require_protocol: true, protocols: ['http', 'https'] }).withMessage('Website must be a valid URL starting with http:// or https://')
    .isLength({ max: 200 }),
  body('isPrivate').optional().isBoolean().withMessage('isPrivate must be true or false').toBoolean(),
];
