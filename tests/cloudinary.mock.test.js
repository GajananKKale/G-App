/*
 * Tests the Cloudinary code path WITHOUT needing a Cloudinary account: the Cloudinary SDK calls are replaced by an
 * in-memory fake that records every upload / delete. Needs MongoDB (MONGO_URI from .env). Run: npm run test:cloudinary
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

process.env.CLOUDINARY_CLOUD_NAME = 'democloud';
process.env.CLOUDINARY_API_KEY = '123456789';
process.env.CLOUDINARY_API_SECRET = 'secret';
process.env.CLOUDINARY_FOLDER = 'g-app-test';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';
process.env.BCRYPT_ROUNDS = '4';
process.env.SEED_ADMIN = 'false';

const { default: cloudinaryPkg } = await import('cloudinary');
const cloud = cloudinaryPkg.v2;

// ---------------- fake Cloudinary ----------------
const uploads = [];
const destroyed = [];
let failUploadsAfter = Infinity; // simulate Cloudinary errors
cloud.uploader.upload_stream = (options, cb) => ({
  end: (buffer) => {
    if (uploads.length >= failUploadsAfter) return cb({ message: 'Invalid API key (simulated)', http_code: 401 });
    const id = `${options.folder}/${crypto.randomBytes(6).toString('hex')}`;
    uploads.push({ id, options, size: buffer.length });
    return cb(null, { public_id: id, secure_url: `https://res.cloudinary.com/democloud/image/upload/v1700000000/${id}.png` });
  },
});
cloud.uploader.destroy = async (id) => {
  destroyed.push(id);
  return { result: 'ok' };
};
cloud.api.ping = async () => ({ status: 'OK' });

// ---------------- boot the real app ----------------
const { default: env } = await import('../config/env.js');
const { connectDB, disconnectDB } = await import('../config/db.js');
const { default: app } = await import('../app.js');
const { verifyStorage, isCloudStorage } = await import('../services/storage.service.js');

await connectDB();
await verifyStorage();
const server = app.listen(0);
const BASE = `http://127.0.0.1:${server.address().port}/api`;

let passed = 0;
let failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed += 1; console.log(`  ✔ ${name}`); } else { failed += 1; console.log(`  ✘ ${name} ${extra ? '-> ' + JSON.stringify(extra) : ''}`); }
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const api = async (method, p, { token, json, form } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(BASE + p, { method, headers, body });
  const data = await res.json().catch(() => null);
  return { status: res.status, d: data?.data, body: data };
};
const form = (fields, n) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  for (let i = 0; i < n; i += 1) fd.append('images', new Blob([PNG], { type: 'image/png' }), `a${i}.png`);
  return fd;
};
const localFiles = () => ['posts', 'profiles'].reduce((n, f) => n + (fs.existsSync(path.join(env.uploadDir, f)) ? fs.readdirSync(path.join(env.uploadDir, f)).filter((x) => x !== '.gitkeep').length : 0), 0);

const sfx = Math.random().toString(36).slice(2, 8);
const filesBefore = localFiles();
check('cloud storage mode is active', isCloudStorage() === true);

const reg = await api('POST', '/auth/register', { json: { firstName: 'Cloud', lastName: 'Tester', email: `cloud.${sfx}@example.com`, password: 'Passw0rd123', mobile: `7${String(Date.now()).slice(-9)}`, country: 'IN', state: 'MH', city: 'Pune' } });
const token = reg.d.token;
const userId = reg.d.user._id;

console.log('\n=== posts ===');
let r = await api('POST', '/posts', { token, form: form({ caption: 'cloud post' }, 3) });
check('create post with 3 images -> 201', r.status === 201, r.body);
const post = r.d.post;
check('images are Cloudinary https URLs', post.images.length === 3 && post.images.every((i) => i.url.startsWith('https://res.cloudinary.com/democloud/image/upload/')), post.images);
check('filename stores the Cloudinary public_id', post.images.every((i) => i.filename.startsWith('g-app-test/posts/')));
check('uploaded into the configured folder with size limit transformation', uploads.length === 3 && uploads.every((u) => u.options.folder === 'g-app-test/posts' && u.options.transformation?.[0]?.crop === 'limit'));
check('nothing was written to the local uploads folder', localFiles() === filesBefore);

r = await api('GET', `/posts/${post._id}`, { token });
check('single post returns the same Cloudinary URLs unchanged', r.d.post.images[0].url === post.images[0].url);

// update: add 1, remove 1 by public_id
const removeId = post.images[0].filename;
const upBefore = uploads.length;
const fd = new FormData();
fd.append('caption', 'edited');
fd.append('removeImages', removeId);
fd.append('images', new Blob([PNG], { type: 'image/png' }), 'new.png');
r = await api('PUT', `/posts/${post._id}`, { token, form: fd });
const updatedPost = r.d?.post;
check('update: remove 1 + add 1 image', r.status === 200 && r.d.post.images.length === 3 && !r.d.post.images.some((i) => i.filename === removeId), r.body);
check('update: new image uploaded', uploads.length === upBefore + 1);
check('update: removed image deleted from Cloudinary by public_id', destroyed.includes(removeId), destroyed);

// validation failure must not upload anything
const upBefore2 = uploads.length;
r = await api('POST', '/posts', { token, form: form({ caption: 'x'.repeat(2300) }, 1) });
check('invalid caption -> 422 and NOTHING uploaded to Cloudinary', r.status === 422 && uploads.length === upBefore2);
const nothingFd = new FormData();
nothingFd.append('images', new Blob(['not an image'], { type: 'image/png' }), 'fake.png');
r = await api('POST', '/posts', { token, form: nothingFd });
check('fake image rejected before reaching Cloudinary', r.status === 400 && uploads.length === upBefore2);
const removeAll = new FormData();
updatedPost.images.forEach((i) => removeAll.append('removeImages', i.filename));
const upBefore3 = uploads.length;
r = await api('PUT', `/posts/${post._id}`, { token, form: removeAll });
check('cannot remove every image (400) and nothing uploaded', r.status === 400 && uploads.length === upBefore3, r.body);
check('cannot remove every image (400) without uploading', r.status === 400);

console.log('\n=== failures ===');
const upCount = uploads.length;
failUploadsAfter = uploads.length + 2; // 3rd image of the next request fails
r = await api('POST', '/posts', { token, form: form({ caption: 'will fail' }, 3) });
check('Cloudinary error -> 502 with friendly message', r.status === 502 && /try again/i.test(r.body.message), r.body);
check('the 2 images uploaded before the failure were rolled back (deleted)', uploads.length === upCount + 2 && uploads.slice(-2).every((u) => destroyed.includes(u.id)));
r = await api('GET', `/users/me/posts`, { token });
check('no post was created by the failed request', r.d.posts.length === 1, r.d.posts.length);
failUploadsAfter = Infinity;

console.log('\n=== profile picture ===');
const pf = new FormData();
pf.append('profileImage', new Blob([PNG], { type: 'image/png' }), 'me.png');
r = await api('PUT', '/users/me/profile-image', { token, form: pf });
check('profile picture stored on Cloudinary (profiles folder, square transformation)', r.status === 200 && r.d.user.profilePicture.includes('/g-app-test/profiles/') && uploads.at(-1).options.transformation[0].crop === 'fill', r.body);
const pic1 = r.d.user.profilePicture;
const pf2 = new FormData();
pf2.append('profileImage', new Blob([PNG], { type: 'image/png' }), 'me2.png');
r = await api('PUT', '/users/me/profile-image', { token, form: pf2 });
const pic2 = r.d.user.profilePicture;
check('changing the picture deletes the old one from Cloudinary', pic1 !== pic2 && destroyed.includes(pic1.match(/upload\/v\d+\/(.+)\.png$/)[1]), destroyed);
r = await api('DELETE', '/users/me/profile-image', { token });
check('removing the picture deletes it from Cloudinary', destroyed.includes(pic2.match(/upload\/v\d+\/(.+)\.png$/)[1]));

console.log('\n=== deletes ===');
r = await api('GET', `/posts/${post._id}`, { token });
const ids = r.d.post.images.map((i) => i.filename);
r = await api('DELETE', `/posts/${post._id}`, { token });
check('delete post -> 200', r.status === 200);
check('every image of the post deleted from Cloudinary', ids.every((id) => destroyed.includes(id)), { ids, destroyed });

// admin delete user cascade
const post2 = (await api('POST', '/posts', { token, form: form({ caption: 'p2' }, 2) })).d.post;
const pf3 = new FormData();
pf3.append('profileImage', new Blob([PNG], { type: 'image/png' }), 'm.png');
const pic3 = (await api('PUT', '/users/me/profile-image', { token, form: pf3 })).d.user.profilePicture;
const { ensureAdmin } = await import('../services/seed.service.js');
env.admin.email = `admin.${sfx}@example.com`;
env.admin.mobile = `6${String(Date.now()).slice(-9)}`;
await ensureAdmin();
const adminLogin = await api('POST', '/auth/login', { json: { email: env.admin.email, password: env.admin.password } });
r = await api('DELETE', `/admin/users/${userId}`, { token: adminLogin.d.token });
check('admin deletes user -> 200', r.status === 200, r.body);
check("user's post images and profile picture are removed from Cloudinary", post2.images.every((i) => destroyed.includes(i.filename)) && destroyed.includes(pic3.match(/upload\/v\d+\/(.+)\.png$/)[1]));
check('local uploads folder was never used', localFiles() === filesBefore);

const { default: User } = await import('../models/User.js');
await User.deleteOne({ email: env.admin.email });

console.log(`\n${'-'.repeat(50)}\nPassed: ${passed}   Failed: ${failed}`);
server.close();
await disconnectDB();
process.exit(failed ? 1 : 0);
