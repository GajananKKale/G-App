import multer from 'multer';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Files are kept in memory only; controllers hand them to services/storage.service.js (Cloudinary or local disk)
// after the request has been validated, so rejected requests never leave files behind.
const fileFilter = (req, file, cb) => {
  if (!ALLOWED.includes(file.mimetype)) return cb(new ApiError(400, 'Only JPEG, PNG, WEBP and GIF images are allowed'));
  cb(null, true);
};

// The mimetype header is client controlled, so also check the real file signature.
const hasImageSignature = (buf) => {
  if (!buf || buf.length < 12) return false;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const gif = buf.subarray(0, 4).toString('ascii') === 'GIF8';
  const webp = buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  return jpeg || png || gif || webp;
};

const verifySignatures = (req, res, next) => {
  const files = [...(req.files || []), ...(req.file ? [req.file] : [])];
  if (files.some((f) => !hasImageSignature(f.buffer))) return next(new ApiError(400, 'Uploaded file is not a valid image'));
  next();
};

const storage = multer.memoryStorage();

export const uploadPostImages = [
  multer({ storage, fileFilter, limits: { fileSize: env.maxFileSize, files: env.maxPostImages } }).array('images', env.maxPostImages),
  verifySignatures,
];

export const uploadProfileImage = [
  multer({ storage, fileFilter, limits: { fileSize: env.maxFileSize, files: 1 } }).single('profileImage'),
  verifySignatures,
];
