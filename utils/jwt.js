import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import env from '../config/env.js';

export const signToken = (user) =>
  jwt.sign({ id: String(user._id) }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
    jwtid: crypto.randomBytes(16).toString('hex'),
  });

export const verifyToken = (token) => jwt.verify(token, env.jwtSecret);
