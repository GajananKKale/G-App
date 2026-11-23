import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import cloudinaryPkg from 'cloudinary';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const cloudinary = cloudinaryPkg.v2;
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

export const isCloudStorage = () => env.cloudinary.enabled;

if (env.cloudinary.enabled) {
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
    secure: true,
  });
}

/* --------------------------------- save --------------------------------- */
const saveLocal = async (file, folder) => {
  const dir = path.join(env.uploadDir, folder);
  await fs.promises.mkdir(dir, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${EXT[file.mimetype] || '.jpg'}`;
  await fs.promises.writeFile(path.join(dir, filename), file.buffer);
  return { url: `/uploads/${folder}/${filename}`, filename };
};

// big photos are limited to 2048px, profile pictures become 512x512 squares
const TRANSFORMATIONS = {
  posts: [{ width: 2048, height: 2048, crop: 'limit' }],
  profiles: [{ width: 512, height: 512, crop: 'fill', gravity: 'auto' }],
};

const saveCloud = (file, folder) =>
  new Promise((resolve, reject) => {
    const options = {
      folder: `${env.cloudinary.folder}/${folder}`,
      resource_type: 'image',
      unique_filename: true,
      overwrite: false,
      transformation: TRANSFORMATIONS[folder],
    };
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err || !result) return reject(err || new Error('Empty response from Cloudinary'));
      // filename holds the Cloudinary public_id (needed to delete the image later)
      return resolve({ url: result.secure_url, filename: result.public_id });
    });
    stream.end(file.buffer);
  });

/**
 * Stores uploaded files (multer memory files) and returns [{ url, filename }].
 * folder: 'posts' | 'profiles'. If one upload fails, the ones already stored are removed again.
 */
export const saveImages = async (files = [], folder = 'posts') => {
  const saved = [];
  try {
    for (const file of files) {
      saved.push(await (isCloudStorage() ? saveCloud(file, folder) : saveLocal(file, folder)));
    }
    return saved;
  } catch (err) {
    await Promise.all(saved.map((i) => deleteImage(i.url)));
    console.error('[STORAGE] upload failed:', err?.message || err);
    throw new ApiError(502, 'Could not upload the image right now. Please try again.');
  }
};

/* -------------------------------- delete -------------------------------- */
// "https://res.cloudinary.com/<cloud>/image/upload/v123/g-app/posts/abc.jpg" -> "g-app/posts/abc"
export const publicIdFromUrl = (url) => {
  const m = String(url).match(/^https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/(?:v\d+\/)?(.+)\.[A-Za-z0-9]+(?:\?.*)?$/);
  return m ? decodeURIComponent(m[1]) : null;
};

// Deletes one stored image given its URL / path. Works for Cloudinary and local files. Never throws.
export const deleteImage = async (stored) => {
  try {
    if (!stored) return;
    if (/^https?:\/\//i.test(stored)) {
      const publicId = publicIdFromUrl(stored);
      if (publicId && isCloudStorage()) await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
      return;
    }
    if (!stored.startsWith('/uploads/')) return;
    const full = path.resolve(env.uploadDir, stored.replace(/^\/uploads\//, ''));
    if (!full.startsWith(env.uploadDir + path.sep)) return; // path traversal guard
    await fs.promises.unlink(full);
  } catch (err) {
    if (err?.code !== 'ENOENT') console.error('[STORAGE] delete failed:', err?.message || err);
  }
};

/* ------------------------------ start-up check ------------------------------ */
export const verifyStorage = async () => {
  if (!isCloudStorage()) {
    console.log(`Image storage: LOCAL DISK (${env.uploadDir})`);
    if (env.isProd) {
      console.warn('WARNING: Cloudinary is not configured. On Render/Heroku the disk is temporary - uploaded photos will be lost on every restart. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.');
    }
    return;
  }
  try {
    await cloudinary.api.ping();
    console.log(`Image storage: CLOUDINARY connected (cloud: ${env.cloudinary.cloudName}, folder: ${env.cloudinary.folder})`);
  } catch (err) {
    console.error(`Image storage: Cloudinary check FAILED - ${err?.error?.message || err?.message || err}. Uploads will fail until CLOUDINARY_* values in .env are correct.`);
  }
};
