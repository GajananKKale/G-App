
# Social Media Backend (Instagram-like)

Node.js + Express 5 + MongoDB (Mongoose) REST API with JWT auth, image posts, likes/dislikes, comments,
follow system, notifications, private accounts, user blocking, reports and a full admin backend.
Built to be consumed by a React Native app.

## 1. Quick start

```bash
npm install
cp .env.example .env        # (a ready-to-use .env is already included – change JWT_SECRET!)
npm start                   # or: npm run dev
```

Requirements: Node.js 18+ and a running MongoDB (local `mongodb://127.0.0.1:27017` or MongoDB Atlas – put the URI in `MONGO_URI`).

On first start the **admin account is created automatically** (password stored as a bcrypt hash):

| field    | value               |
|----------|---------------------|
| email    | `gajanan@admin.com` |
| mobile   | `9999999999`        |
| password | `gajnann123`        |

Change these in `.env` (`ADMIN_EMAIL`, `ADMIN_MOBILE`, `ADMIN_PASSWORD`, ...). `npm run seed:admin` re-creates the admin / resets its password to the `.env` value.
**Change the admin password and `JWT_SECRET` before going to production.**

## 2. Admin-only area

Everything under `/api/admin/*` requires a valid JWT **and** `role === "admin"`
(`router.use(protect, authorize('admin'))`). Normal users get `403`, requests without token `401`.
Users can never promote themselves: `role` is ignored on register and on profile update; only an admin can change it
(`PATCH /api/admin/users/:id/role`).

## 3. Using it from React Native

* Base URL: `http://<your-ip>:5000/api` (Android emulator: `http://10.0.2.2:5000/api`; real device: your PC's LAN IP). Set `BASE_URL` in `.env` to that same address so image URLs are reachable.
* Send the token on every protected request: `Authorization: Bearer <token>`.
* All responses: `{ success, message, data?, meta? }`; errors: `{ success:false, message, errors?[{field,message}] }`; lists have `meta: { page, limit, total, totalPages, hasNextPage, hasPrevPage }`.
* Image URLs in responses are absolute (`BASE_URL` + `/uploads/...`).
* Upload example (post with images):

```js
const fd = new FormData();
fd.append('caption', 'Hello');
fd.append('location', 'Mumbai');
images.forEach((img) => fd.append('images', { uri: img.uri, name: 'photo.jpg', type: 'image/jpeg' }));
await fetch(`${API}/posts`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd }); // don't set Content-Type manually
```
* Profile picture: `PUT /users/me/profile-image`, multipart field **`profileImage`**.
* Post images: field **`images`** (max 10, JPEG/PNG/WEBP/GIF, 5 MB each; real file signature is checked).
* Password reset / email verification emails contain a token. In development (`EXPOSE_DEV_TOKENS=true`, SMTP empty) the token is returned in the API response (`devResetToken`, `devVerificationToken`) and emails are only logged, so everything can be tested without SMTP. In production set SMTP_* values; tokens are never returned.

## 4. API overview (prefix `/api`)

**Auth** – `POST /auth/register` · `POST /auth/login` (email **or** mobile + password) · `POST /auth/logout` · `GET /auth/me` · `POST /auth/forgot-password` · `POST /auth/reset-password {token,password}` · `PUT /auth/change-password` · `GET /auth/verify-email/:token` · `POST /auth/resend-verification`

**Users** – `GET|PUT /users/me` · `PUT /users/me/profile-image` · `DELETE /users/me/profile-image` · `GET /users/:id` · `GET /users/search?q=` · `GET /users/me/posts` · `GET /users/:id/posts` · `GET /users/me/saved` · `POST|DELETE /users/:id/block` · `GET /users/me/blocked`

**Posts** – `POST /posts` · `GET /posts` · `GET /feed` (`?following=true`) · `GET /posts/:id` · `PUT /posts/:id` (add `images`, remove via `removeImages`) · `DELETE /posts/:id` (owner or admin) · `GET /posts/user/:userId` · `GET /posts/search?q=` · `POST|DELETE /posts/:id/save` · `POST /posts/:id/share` · `POST /posts/:id/report`

**Reactions** – `POST|DELETE /posts/:id/like` · `POST|DELETE /posts/:id/dislike` · `GET /posts/:id/reactions?type=like|dislike`. One reaction per user per post (unique index); liking removes a dislike and vice-versa, counters updated atomically.

**Comments** – `GET|POST /posts/:postId/comments` · `PUT|DELETE /comments/:id` · `GET|POST /comments/:id/replies` · `POST|DELETE /comments/:id/like`

**Follow** – `POST|DELETE /users/:id/follow` · `GET /users/:id/followers` · `GET /users/:id/following` · `GET /users/:id/follow-status` · private accounts: `GET /users/me/follow-requests` · `POST /users/me/follow-requests/:userId/accept|reject` · `DELETE /users/me/followers/:userId`

**Notifications** – `GET /notifications` · `GET /notifications/unread-count` · `PATCH /notifications/read-all` · `PATCH /notifications/:id/read` · `DELETE /notifications/:id`  (follow, follow request/accepted, like, comment, reply, comment-like)

**Admin** (`/admin/...`) – `dashboard` · `users` (list/search/filter, get, update, delete, `block`, `unblock`, `role`, `posts`, `followers`, `following`) · `posts` (list, get, create, update, delete, `hide`, `unhide`) · `comments` (list, delete, `hide`, `unhide`) · `reports` (list, update status / hide post)

A ready Postman collection with all 85 requests is in `docs/Social-Media-API.postman_collection.json` (tokens are saved automatically after Register/Login).

## 5. Project structure

```
config/        env + database connection
models/        User, Post, Comment, Follow, Reaction, Notification, SavedPost (+ CommentLike, Block, Report, TokenBlacklist)
controllers/   business logic
routes/        API routes
middlewares/   auth (JWT + role), upload (multer), validation, error handling, rate limit, input sanitising
validators/    express-validator rules
services/      email (nodemailer), image storage (Cloudinary / local), notifications, visibility rules, follow/post/comment/user logic
utils/         jwt, password, response, pagination, files, transactions
templates/     HTML email templates
uploads/       local image storage, only used when Cloudinary is NOT configured (served at /uploads)
scripts/       seedAdmin.js, auditIntegrity.js
tests/         e2e.test.js (247 checks)
app.js / server.js
```

## 6. Behaviour notes

* **Security**: bcrypt hashes (never returned), JWT with expiry, logout blacklist (TTL index), tokens invalid after password change, blocked/deleted users rejected on every request, helmet, CORS, rate limits (global + strict on auth), NoSQL-operator stripping, centralised error handling, ownership checks, unique indexes against duplicate likes/follows.
* **Privacy**: private accounts hide posts from non-followers (feed, direct access, lists); blocked users (either direction) can't see or follow each other; hidden (moderated) posts/comments are invisible to others.
* **Counters** (likes, comments, followers, ...) are stored on the documents and updated atomically with `$inc`; deleting posts/comments/users cascades and corrects all counters.
* **Transactions**: set `USE_TRANSACTIONS=true` only if MongoDB is a replica set / Atlas (standalone MongoDB doesn't support them). Both modes pass the full test-suite.
* Rate limits are per IP; behind a proxy set `TRUST_PROXY=true`.
* **Image storage:** Cloudinary when `CLOUDINARY_*` is set in `.env`, otherwise the local `uploads/` folder (see section 8).

## 7. Testing

```bash
# terminal 1 – relaxed rate limits & fast hashing just for the test run
AUTH_RATE_LIMIT_MAX=100000 RATE_LIMIT_MAX=100000 BCRYPT_ROUNDS=4 npm start
# terminal 2
npm run test:e2e     # 247 checks across every module
npm run audit        # verifies counters / password hashes / orphaned files in the database
npm run test:cloudinary   # tests the Cloudinary code path with a simulated Cloudinary (no account needed)
```

## 8. Image storage with Cloudinary

Photos are stored on **Cloudinary** when these values are present in `.env`:

```
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
CLOUDINARY_FOLDER=g-app        # optional
```
(or the single `CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud_name>` from the Cloudinary dashboard).

* On start the server prints `Image storage: CLOUDINARY connected (...)` – or the reason why the credentials are wrong.
* Post photos are stored in `<folder>/posts` (limited to 2048 px), profile pictures in `<folder>/profiles` (512x512 square).
* The API returns the normal `https://res.cloudinary.com/...` URLs; the React Native app needs no change.
* Deleting a post / user, removing an image from a post, or replacing a profile picture also deletes the file on Cloudinary.
* If an upload fails (wrong credentials, no internet) the API answers `502` and nothing is half-saved.
* Without the three values the app falls back to local disk, which is fine for development but **not** for hosting on Render
  (its disk is wiped on every restart/redeploy). In production the server prints a warning if Cloudinary is missing.
* Old images that are already stored locally keep working as long as the files exist; new uploads go to Cloudinary.

## 9. Deploying on Render (with Atlas + Cloudinary)

1. Push the backend folder to a GitHub repository (the `.env` file is git-ignored – never commit secrets).
2. Render -> New -> Web Service -> pick the repo. Build command: `npm install`  Start command: `npm start`.
3. Add these Environment Variables on Render:

| name | value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGO_URI` | your Atlas connection string (Atlas -> Network Access must allow `0.0.0.0/0`) |
| `JWT_SECRET` | a long random string (32+ chars) |
| `BASE_URL` | `https://<your-service>.onrender.com` |
| `TRUST_PROXY` | `true` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | your admin login (created on first start) |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | from the Cloudinary dashboard |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | needed for password-reset / verification emails in production |

4. Open `https://<your-service>.onrender.com/api/health` – it must answer `API is running`; check the Render logs for
   `Image storage: CLOUDINARY connected`.
5. In the React Native app set `PRODUCTION_API_URL = 'https://<your-service>.onrender.com/api'` and build the APK.
=======

