import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ quiet: true });

const required = ['MONGO_URI', 'JWT_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

const bool = (v, def = false) => (v === undefined || v === '' ? def : String(v).toLowerCase() === 'true');
const num = (v, def) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? def : Number(v));

// Cloudinary credentials: either the 3 separate variables or the single CLOUDINARY_URL (cloudinary://key:secret@cloud_name)
const parseCloudinaryUrl = (url) => {
  const m = String(url || '').trim().match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/i);
  return m ? { apiKey: m[1], apiSecret: m[2], cloudName: m[3] } : {};
};
const fromUrl = parseCloudinaryUrl(process.env.CLOUDINARY_URL);
const cloudinaryCfg = {
  cloudName: (process.env.CLOUDINARY_CLOUD_NAME || fromUrl.cloudName || '').trim(),
  apiKey: (process.env.CLOUDINARY_API_KEY || fromUrl.apiKey || '').trim(),
  apiSecret: (process.env.CLOUDINARY_API_SECRET || fromUrl.apiSecret || '').trim(),
  folder: (process.env.CLOUDINARY_FOLDER || 'g-app').trim().replace(/^\/+|\/+$/g, ''),
};
cloudinaryCfg.enabled = !!(cloudinaryCfg.cloudName && cloudinaryCfg.apiKey && cloudinaryCfg.apiSecret);

const nodeEnv = process.env.NODE_ENV || 'development';
const port = num(process.env.PORT, 5000);

if (nodeEnv === 'production' && process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be at least 32 characters in production.');
  process.exit(1);
}

const env = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  port,
  mongoUri: process.env.MONGO_URI,
  useTransactions: bool(process.env.USE_TRANSACTIONS, false),

  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  bcryptRounds: num(process.env.BCRYPT_ROUNDS, 12),

  baseUrl: (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  clientUrl: (process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  trustProxy: bool(process.env.TRUST_PROXY, false),

  uploadDir: path.resolve(process.env.UPLOAD_DIR || 'uploads'),
  maxFileSize: num(process.env.MAX_FILE_SIZE_MB, 5) * 1024 * 1024,
  maxPostImages: num(process.env.MAX_POST_IMAGES, 10),

  cloudinary: cloudinaryCfg,

  rateLimitWindowMs: num(process.env.RATE_LIMIT_WINDOW_MINUTES, 15) * 60 * 1000,
  rateLimitMax: num(process.env.RATE_LIMIT_MAX, 300),
  authRateLimitMax: num(process.env.AUTH_RATE_LIMIT_MAX, 20),

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: num(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'Social App <no-reply@socialapp.local>',
  },
  appName: process.env.APP_NAME || 'Social App',
  exposeDevTokens: bool(process.env.EXPOSE_DEV_TOKENS, nodeEnv !== 'production'),

  seedAdmin: bool(process.env.SEED_ADMIN, true),
  admin: {
    firstName: process.env.ADMIN_FIRST_NAME || 'Gajanan',
    lastName: process.env.ADMIN_LAST_NAME || 'Admin',
    email: (process.env.ADMIN_EMAIL || 'gajanan@admin.com').toLowerCase(),
    mobile: process.env.ADMIN_MOBILE || '9999999999',
    password: process.env.ADMIN_PASSWORD || 'gajnann123',
    country: process.env.ADMIN_COUNTRY || 'India',
    state: process.env.ADMIN_STATE || 'Maharashtra',
    city: process.env.ADMIN_CITY || 'Mumbai',
  },
};

export default env;
