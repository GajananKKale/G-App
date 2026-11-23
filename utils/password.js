import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import env from '../config/env.js';

export const hashPassword = (plain) => bcrypt.hash(plain, env.bcryptRounds);
export const comparePassword = (plain, hash) => bcrypt.compare(plain, hash);
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
