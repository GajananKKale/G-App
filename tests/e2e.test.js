/*
 * End-to-end API test. Run the server first, then:  npm run test:e2e
 *
 * Tip: the server rate-limits login/register. Start it with higher limits for the test run:
 *   AUTH_RATE_LIMIT_MAX=100000 RATE_LIMIT_MAX=100000 BCRYPT_ROUNDS=4 npm start
 *
 * Env: API_URL (default http://localhost:5000), ADMIN_EMAIL, ADMIN_PASSWORD
 */
const BASE = process.env.API_URL || 'http://localhost:5000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'gajanan@admin.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'gajnann123';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let passed = 0;
let failed = 0;
const failures = [];
const check = (name, cond, extra = '') => {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ✘ ${name} ${extra ? `-> ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : ''}`);
  }
};
const section = (t) => console.log(`\n=== ${t} ===`);

async function api(method, path, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  if (form) body = form;
  const res = await fetch(`${BASE}/api${path}`, { method, headers, body });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not json */
  }
  return { status: res.status, body: data, d: data?.data, meta: data?.meta, headers: res.headers };
}

const imgBlob = (type = 'image/png', buf = PNG) => new Blob([buf], { type });
const postForm = (fields = {}, nImages = 1, extra = []) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (let i = 0; i < nImages; i += 1) fd.append('images', imgBlob(), `img${i}.png`);
  for (const [k, v] of extra) fd.append(k, v);
  return fd;
};

const sfx = Math.random().toString(36).slice(2, 8);
let counter = 0;
const newUserData = (name) => {
  counter += 1;
  return {
    firstName: name,
    lastName: 'Tester',
    email: `${name.toLowerCase()}.${sfx}@example.com`,
    password: 'Passw0rd123',
    mobile: `9${String(Date.now()).slice(-7)}${counter}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 11),
    country: 'India',
    state: 'Maharashtra',
    city: 'Mumbai',
  };
};

const register = async (name) => {
  const data = newUserData(name);
  const r = await api('POST', '/auth/register', { json: data });
  return { data, r, token: r.d?.token, id: r.d?.user?._id, verifyToken: r.d?.devVerificationToken };
};

(async () => {
  /* ---------------------------------------------------------------- */
  section('Health & basics');
  let r = await api('GET', '/health');
  check('health endpoint', r.status === 200 && r.body.success === true);
  r = await api('GET', '/does-not-exist');
  check('unknown route -> 404 JSON', r.status === 404 && r.body.success === false);
  r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
  check('malformed JSON -> 400', r.status === 400);
  r = await api('GET', '/health');
  check('rate-limit headers present', !!(r.headers.get('ratelimit') || r.headers.get('ratelimit-policy') || r.headers.get('x-ratelimit-limit')));

  /* ---------------------------------------------------------------- */
  section('Registration');
  const bad = await api('POST', '/auth/register', { json: { firstName: '', email: 'nope', password: '123' } });
  check('invalid registration -> 422 with field errors', bad.status === 422 && Array.isArray(bad.body.errors) && bad.body.errors.length >= 3, bad.body);
  const weak = await api('POST', '/auth/register', { json: { ...newUserData('Weak'), password: 'onlyletters' } });
  check('password without number -> 422', weak.status === 422);
  const badMobile = await api('POST', '/auth/register', { json: { ...newUserData('Bm'), mobile: 'abc' } });
  check('invalid mobile -> 422', badMobile.status === 422);

  const alice = await register('Alice');
  check('register alice -> 201 + token', alice.r.status === 201 && !!alice.token, alice.r.body);
  check('password hash never returned', alice.r.d.user.password === undefined && !JSON.stringify(alice.r.body).includes('$2'));
  check('role automatically "user"', alice.r.d.user.role === 'user');
  check('dev verification token returned in development', !!alice.verifyToken);

  const bob = await register('Bob');
  const carol = await register('Carol');
  const dave = await register('Dave');

  const roleInject = await api('POST', '/auth/register', { json: { ...newUserData('Mallory'), role: 'admin' } });
  check('cannot self-register as admin (role ignored)', roleInject.status === 201 && roleInject.d.user.role === 'user');
  const mallory = { token: roleInject.d.token, id: roleInject.d.user._id };

  const dupEmail = await api('POST', '/auth/register', { json: { ...newUserData('X'), email: alice.data.email } });
  check('duplicate email -> 409', dupEmail.status === 409, dupEmail.body);
  const dupMobile = await api('POST', '/auth/register', { json: { ...newUserData('Y'), mobile: alice.data.mobile } });
  check('duplicate mobile -> 409', dupMobile.status === 409, dupMobile.body);

  /* ---------------------------------------------------------------- */
  section('Login / auth');
  r = await api('POST', '/auth/login', { json: { email: alice.data.email, password: alice.data.password } });
  check('login with email + password', r.status === 200 && !!r.d.token);
  alice.token = r.d.token;
  r = await api('POST', '/auth/login', { json: { mobile: alice.data.mobile, password: alice.data.password } });
  check('login with mobile + password', r.status === 200 && !!r.d.token);
  r = await api('POST', '/auth/login', { json: { email: alice.data.email.toUpperCase(), password: alice.data.password } });
  check('email login is case-insensitive', r.status === 200);
  r = await api('POST', '/auth/login', { json: { email: alice.data.email, password: 'WrongPass1' } });
  check('wrong password -> 401', r.status === 401);
  r = await api('POST', '/auth/login', { json: { password: 'abc12345' } });
  check('login without email/mobile -> 422', r.status === 422);
  r = await api('POST', '/auth/login', { json: { email: { $ne: null }, password: { $ne: null } } });
  check('NoSQL injection in login is rejected', r.status >= 400 && r.status < 500 && !r.d?.token, r.body);

  r = await api('GET', '/auth/me');
  check('protected route without token -> 401', r.status === 401);
  r = await api('GET', '/auth/me', { token: 'garbage.token.here' });
  check('invalid token -> 401', r.status === 401);
  r = await api('GET', '/auth/me', { token: alice.token });
  check('GET /auth/me returns logged-in user', r.status === 200 && r.d.user.email === alice.data.email.toLowerCase());

  // logout revokes token
  const tmp = await api('POST', '/auth/login', { json: { email: bob.data.email, password: bob.data.password } });
  r = await api('POST', '/auth/logout', { token: tmp.d.token });
  check('logout works', r.status === 200);
  r = await api('GET', '/auth/me', { token: tmp.d.token });
  check('token unusable after logout', r.status === 401);

  // email verification
  r = await api('GET', `/auth/verify-email/${alice.verifyToken}`);
  check('email verification with token', r.status === 200, r.body);
  r = await api('GET', '/auth/me', { token: alice.token });
  check('isEmailVerified is true afterwards', r.d.user.isEmailVerified === true);
  r = await api('GET', '/auth/verify-email/invalidtoken');
  check('invalid verification token -> 400', r.status === 400);

  // forgot / reset password
  r = await api('POST', '/auth/forgot-password', { json: { email: 'nobody@example.com' } });
  check('forgot-password for unknown email gives generic 200', r.status === 200 && !r.d?.devResetToken);
  r = await api('POST', '/auth/forgot-password', { json: { email: carol.data.email } });
  check('forgot-password returns dev token', r.status === 200 && !!r.d?.devResetToken, r.body);
  const resetToken = r.d.devResetToken;
  r = await api('POST', '/auth/reset-password', { json: { token: 'bad', password: 'NewPassw0rd1' } });
  check('reset with invalid token -> 400', r.status === 400);
  r = await api('POST', '/auth/reset-password', { json: { token: resetToken, password: 'short' } });
  check('reset with weak password -> 422', r.status === 422);
  r = await api('POST', '/auth/reset-password', { json: { token: resetToken, password: 'NewPassw0rd1' } });
  check('reset password', r.status === 200, r.body);
  r = await api('POST', '/auth/reset-password', { json: { token: resetToken, password: 'AnotherPass1' } });
  check('reset token cannot be reused', r.status === 400);
  r = await api('POST', '/auth/login', { json: { email: carol.data.email, password: carol.data.password } });
  check('old password no longer works', r.status === 401);
  carol.data.password = 'NewPassw0rd1';
  r = await api('POST', '/auth/login', { json: { email: carol.data.email, password: carol.data.password } });
  check('login with new password', r.status === 200);
  carol.token = r.d.token;

  // change password
  r = await api('PUT', '/auth/change-password', { token: dave.token, json: { currentPassword: 'Wrong123x', newPassword: 'DaveNew123' } });
  check('change password with wrong current -> 400', r.status === 400);
  r = await api('PUT', '/auth/change-password', { token: dave.token, json: { currentPassword: dave.data.password, newPassword: dave.data.password } });
  check('new password must differ -> 422', r.status === 422);
  const oldDaveToken = dave.token;
  r = await api('PUT', '/auth/change-password', { token: dave.token, json: { currentPassword: dave.data.password, newPassword: 'DaveNew123' } });
  check('change password', r.status === 200 && !!r.d.token, r.body);
  dave.token = r.d.token;
  dave.data.password = 'DaveNew123';
  r = await api('GET', '/auth/me', { token: oldDaveToken });
  check('old token invalid after password change', r.status === 401);
  r = await api('GET', '/auth/me', { token: dave.token });
  check('new token works after password change', r.status === 200);

  /* ---------------------------------------------------------------- */
  section('Admin login (seeded account, hashed password)');
  r = await api('POST', '/auth/login', { json: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  check('admin can log in with seeded credentials', r.status === 200 && r.d.user.role === 'admin', r.body);
  const adminToken = r.d.token;
  const adminId = r.d.user._id;
  check('admin response has no password hash', r.d.user.password === undefined);
  r = await api('POST', '/auth/login', { json: { mobile: r.d.user.mobile, password: ADMIN_PASSWORD } });
  check('admin can also log in with mobile', r.status === 200);

  /* ---------------------------------------------------------------- */
  section('Admin-only routes are closed for normal users');
  const adminGets = ['/admin/dashboard', '/admin/users', '/admin/posts', '/admin/comments', '/admin/reports'];
  for (const p of adminGets) {
    const noTok = await api('GET', p);
    const asUser = await api('GET', p, { token: alice.token });
    const asAdmin = await api('GET', p, { token: adminToken });
    check(`GET ${p}: no token 401 / user 403 / admin 200`, noTok.status === 401 && asUser.status === 403 && asAdmin.status === 200, [noTok.status, asUser.status, asAdmin.status]);
  }
  r = await api('DELETE', `/admin/users/${bob.id}`, { token: alice.token });
  check('normal user cannot delete users via admin route', r.status === 403);
  r = await api('PATCH', `/admin/users/${alice.id}/role`, { token: alice.token, json: { role: 'admin' } });
  check('user cannot make themselves admin', r.status === 403);
  r = await api('PUT', '/users/me', { token: alice.token, json: { role: 'admin', isBlocked: true, followersCount: 999 } });
  r = await api('GET', '/users/me', { token: alice.token });
  check('role / counters cannot be changed through profile update', r.d.user.role === 'user' && r.d.user.followersCount === 0 && r.d.user.isBlocked === false);

  /* ---------------------------------------------------------------- */
  section('Profile');
  r = await api('PUT', '/users/me', {
    token: alice.token,
    json: { firstName: 'Alicia', bio: 'Hello world', address: '12 Marine Drive', pincode: '400001', website: 'https://alice.example.com', city: 'Pune', state: 'MH', country: 'India' },
  });
  check('update profile (name, bio, address, pincode, website, location)', r.status === 200 && r.d.user.firstName === 'Alicia' && r.d.user.bio === 'Hello world' && r.d.user.pincode === '400001' && r.d.user.city === 'Pune', r.body);
  r = await api('PUT', '/users/me', { token: alice.token, json: { website: 'not a url' } });
  check('invalid website -> 422', r.status === 422);
  r = await api('PUT', '/users/me', { token: alice.token, json: { email: bob.data.email } });
  check('update email to existing one -> 409', r.status === 409);
  r = await api('PUT', '/users/me', { token: alice.token, json: { mobile: bob.data.mobile } });
  check('update mobile to existing one -> 409', r.status === 409);
  const newMobile = `8${String(Date.now()).slice(-9)}`;
  r = await api('PUT', '/users/me', { token: alice.token, json: { mobile: newMobile } });
  check('update mobile', r.status === 200 && r.d.user.mobile === newMobile);
  alice.data.mobile = newMobile;

  // profile image
  let fd = new FormData();
  fd.append('profileImage', imgBlob(), 'me.png');
  r = await api('PUT', '/users/me/profile-image', { token: alice.token, form: fd });
  check('upload profile picture', r.status === 200 && /\/uploads\/profiles\//.test(r.d.user.profilePicture), r.body);
  const pic1 = r.d.user.profilePicture;
  let img = await fetch(pic1);
  check('uploaded profile picture is publicly served', img.status === 200 && img.headers.get('content-type')?.includes('image/png'));
  fd = new FormData();
  fd.append('profileImage', imgBlob(), 'me2.png');
  r = await api('PUT', '/users/me/profile-image', { token: alice.token, form: fd });
  const pic2 = r.d.user.profilePicture;
  check('change profile picture', r.status === 200 && pic2 !== pic1);
  img = await fetch(pic1);
  check('old profile picture file was deleted', img.status === 404);
  fd = new FormData();
  fd.append('profileImage', new Blob(['this is not an image at all'], { type: 'image/png' }), 'fake.png');
  r = await api('PUT', '/users/me/profile-image', { token: alice.token, form: fd });
  check('fake image (wrong signature) rejected', r.status === 400, r.body);
  fd = new FormData();
  fd.append('profileImage', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
  r = await api('PUT', '/users/me/profile-image', { token: alice.token, form: fd });
  check('non-image mime type rejected', r.status === 400);
  fd = new FormData();
  fd.append('profileImage', new Blob([Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)])], { type: 'image/png' }), 'big.png');
  r = await api('PUT', '/users/me/profile-image', { token: alice.token, form: fd });
  check('file larger than 5MB rejected', r.status === 400, r.body);
  r = await api('PUT', '/users/me/profile-image', { token: alice.token, form: new FormData() });
  check('missing file -> 400', r.status === 400);

  // other profile
  r = await api('GET', `/users/${bob.id}`, { token: alice.token });
  check('view other user profile (with counts + follow status)', r.status === 200 && r.d.user.followersCount === 0 && r.d.user.followStatus === 'none' && r.d.user.postsCount === 0);
  check('other profile hides email / mobile / role', r.d.user.email === undefined && r.d.user.mobile === undefined && r.d.user.role === undefined);
  r = await api('GET', `/users/${alice.id}`, { token: alice.token });
  check('own profile via /users/:id shows email', r.d.user.email === alice.data.email.toLowerCase() && r.d.user.isMe === true);
  r = await api('GET', '/users/123', { token: alice.token });
  check('invalid user id -> 422', r.status === 422);
  r = await api('GET', '/users/64b7f0f0f0f0f0f0f0f0f0f0', { token: alice.token });
  check('unknown user -> 404', r.status === 404);

  // search users
  r = await api('GET', `/users/search?q=${encodeURIComponent('Bob Tester')}`, { token: alice.token });
  check('search users by full name', r.status === 200 && r.d.users.some((u) => u._id === bob.id), r.body);
  r = await api('GET', '/users/search?q=bo', { token: alice.token });
  check('search users partial', r.d.users.some((u) => u._id === bob.id) && r.meta.total >= 1);
  r = await api('GET', '/users/search', { token: alice.token });
  check('search without q -> 422', r.status === 422);

  /* ---------------------------------------------------------------- */
  section('Posts');
  r = await api('POST', '/posts', { token: alice.token, form: postForm({ caption: 'no image' }, 0) });
  check('post without image -> 400', r.status === 400);
  r = await api('POST', '/posts', { form: postForm({ caption: 'x' }, 1) });
  check('create post without auth -> 401', r.status === 401);
  fd = new FormData();
  fd.append('images', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
  r = await api('POST', '/posts', { token: alice.token, form: fd });
  check('post with non-image -> 400', r.status === 400);
  r = await api('POST', '/posts', { token: alice.token, form: postForm({ caption: 'x' }, 11) });
  check('post with 11 images -> 400', r.status === 400, r.body);

  r = await api('POST', '/posts', { token: alice.token, form: postForm({ caption: 'First post #hello', location: 'Mumbai' }, 2) });
  check('create post with multiple images, caption, location', r.status === 201 && r.d.post.images.length === 2 && r.d.post.location === 'Mumbai', r.body);
  const post1 = r.d.post;
  check('post images are absolute URLs', post1.images.every((i) => i.url.startsWith('http')));
  check('post includes author name + profile image', post1.author.firstName === 'Alicia' && !!post1.author.profilePicture && post1.author.fullName === 'Alicia Tester');
  check('post has like/dislike/comment counts', post1.likesCount === 0 && post1.dislikesCount === 0 && post1.commentsCount === 0);
  r = await api('POST', '/posts', { token: alice.token, form: postForm({ caption: 'Second post' }, 1) });
  const post2 = r.d.post;
  r = await api('GET', '/users/me', { token: alice.token });
  check('postsCount updated on user', r.d.user.postsCount === 2);

  r = await api('GET', `/posts/${post1._id}`, { token: bob.token });
  check('view individual post', r.status === 200 && r.d.post._id === post1._id);
  r = await api('GET', `/posts/${post1._id}`);
  check('view post without auth -> 401', r.status === 401);
  r = await api('GET', '/posts/64b7f0f0f0f0f0f0f0f0f0f0', { token: bob.token });
  check('unknown post -> 404', r.status === 404);

  r = await api('GET', '/posts?page=1&limit=1', { token: bob.token });
  check('feed pagination (limit 1) + latest first', r.status === 200 && r.d.posts.length === 1 && r.d.posts[0]._id === post2._id && r.meta.hasNextPage === true && r.meta.total >= 2, r.meta);
  r = await api('GET', '/feed?page=2&limit=1', { token: bob.token });
  check('feed page 2', r.status === 200 && r.d.posts[0]?._id === post1._id);
  r = await api('GET', '/feed', { token: bob.token });
  check('feed requires login & returns posts', r.status === 200 && r.d.posts.length >= 2);
  r = await api('GET', '/feed');
  check('feed without login -> 401', r.status === 401);
  r = await api('GET', `/users/${alice.id}/posts`, { token: bob.token });
  check('view other user posts', r.status === 200 && r.d.posts.length === 2 && r.meta.total === 2);
  r = await api('GET', `/posts/user/${alice.id}`, { token: bob.token });
  check('alias /posts/user/:id works', r.status === 200 && r.d.posts.length === 2);
  r = await api('GET', '/users/me/posts', { token: alice.token });
  check('view own posts', r.status === 200 && r.d.posts.length === 2);
  r = await api('GET', '/posts/search?q=first', { token: bob.token });
  check('search posts by caption', r.status === 200 && r.d.posts.length >= 1 && r.d.posts[0]._id === post1._id);
  r = await api('GET', '/posts/search?q=.*', { token: bob.token });
  check('regex chars in search are escaped', r.status === 200 && r.d.posts.length === 0);

  // update
  r = await api('PUT', `/posts/${post1._id}`, { token: bob.token, form: postForm({ caption: 'hacked' }, 0) });
  check("cannot edit someone else's post -> 403", r.status === 403);
  r = await api('PUT', `/posts/${post1._id}`, { token: alice.token, form: postForm({ caption: 'Edited caption', location: 'Pune' }, 1, []) });
  check('update caption, location and add image', r.status === 200 && r.d.post.caption === 'Edited caption' && r.d.post.location === 'Pune' && r.d.post.images.length === 3, r.body);
  const removeName = r.d.post.images[0].filename;
  const removeUrl = r.d.post.images[0].url;
  r = await api('PUT', `/posts/${post1._id}`, { token: alice.token, form: postForm({}, 0, [['removeImages', removeName]]) });
  check('remove an image from post', r.status === 200 && r.d.post.images.length === 2 && !r.d.post.images.some((i) => i.filename === removeName), r.body);
  img = await fetch(removeUrl);
  check('removed image file deleted from disk', img.status === 404);
  r = await api('PUT', `/posts/${post1._id}`, { token: alice.token, form: postForm({}, 0, r.d.post.images.map((i) => ['removeImages', i.filename])) });
  check('cannot remove every image -> 400', r.status === 400, r.body);

  /* ---------------------------------------------------------------- */
  section('Like / dislike');
  const P = post1._id;
  r = await api('POST', `/posts/${P}/like`, { token: bob.token });
  check('like post', r.status === 200 && r.d.likesCount === 1 && r.d.isLiked === true && r.d.dislikesCount === 0, r.body);
  r = await api('POST', `/posts/${P}/like`, { token: bob.token });
  check('liking twice does not double count', r.d.likesCount === 1);
  r = await api('POST', `/posts/${P}/dislike`, { token: bob.token });
  check('dislike removes previous like', r.d.likesCount === 0 && r.d.dislikesCount === 1 && r.d.reaction === 'dislike' && r.d.isDisliked === true, r.body);
  r = await api('POST', `/posts/${P}/like`, { token: bob.token });
  check('like removes previous dislike', r.d.likesCount === 1 && r.d.dislikesCount === 0 && r.d.reaction === 'like');
  r = await api('POST', `/posts/${P}/like`, { token: carol.token });
  r = await api('POST', `/posts/${P}/dislike`, { token: dave.token });
  r = await api('GET', `/posts/${P}`, { token: bob.token });
  check('post shows total likes & dislikes + my reaction', r.d.post.likesCount === 2 && r.d.post.dislikesCount === 1 && r.d.post.isLiked === true && r.d.post.isDisliked === false);
  r = await api('GET', `/posts/${P}`, { token: dave.token });
  check('reaction flags are per-user', r.d.post.isDisliked === true && r.d.post.isLiked === false);
  r = await api('GET', `/posts/${P}/reactions?type=like`, { token: bob.token });
  check('list users who liked', r.status === 200 && r.d.users.length === 2);
  r = await api('DELETE', `/posts/${P}/like`, { token: carol.token });
  check('unlike post', r.status === 200 && r.d.likesCount === 1 && r.d.reaction === null);
  r = await api('DELETE', `/posts/${P}/like`, { token: carol.token });
  check('unlike when not liked is harmless', r.status === 200 && r.d.likesCount === 1);
  r = await api('DELETE', `/posts/${P}/dislike`, { token: dave.token });
  check('remove dislike', r.status === 200 && r.d.dislikesCount === 0 && r.d.reaction === null);
  // concurrency: same user hammering like
  await Promise.all(Array.from({ length: 12 }, () => api('POST', `/posts/${P}/like`, { token: dave.token })));
  r = await api('GET', `/posts/${P}`, { token: dave.token });
  check('12 parallel likes by one user count only once', r.d.post.likesCount === 2 && r.d.post.isLiked, r.d.post.likesCount);
  await Promise.all(Array.from({ length: 6 }, (_, i) => api('POST', `/posts/${P}/${i % 2 ? 'dislike' : 'like'}`, { token: dave.token })));
  r = await api('GET', `/posts/${P}`, { token: dave.token });
  check('mixed parallel like/dislike keeps exactly one reaction and consistent counts', r.d.post.likesCount + r.d.post.dislikesCount === 2 && (r.d.post.isLiked ? r.d.post.likesCount === 2 : r.d.post.dislikesCount === 1), [r.d.post.likesCount, r.d.post.dislikesCount, r.d.post.isLiked]);
  await api('DELETE', `/posts/${P}/like`, { token: dave.token });
  await api('DELETE', `/posts/${P}/dislike`, { token: dave.token });
  r = await api('GET', `/posts/${P}`, { token: dave.token });
  check('counts return to exact values after cleanup (no drift)', r.d.post.likesCount === 1 && r.d.post.dislikesCount === 0, [r.d.post.likesCount, r.d.post.dislikesCount]);
  r = await api('POST', `/posts/${P}/like`);
  check('like requires auth', r.status === 401);

  /* ---------------------------------------------------------------- */
  section('Comments');
  r = await api('POST', `/posts/${P}/comments`, { token: bob.token, json: { text: '' } });
  check('empty comment -> 422', r.status === 422);
  r = await api('POST', `/posts/${P}/comments`, { token: bob.token, json: { text: 'Nice pic!' } });
  check('add comment (with commenter name + picture fields + date)', r.status === 201 && r.d.comment.author.firstName === 'Bob' && !!r.d.comment.createdAt, r.body);
  const c1 = r.d.comment;
  r = await api('POST', `/posts/${P}/comments`, { token: carol.token, json: { text: 'Great!' } });
  const c2 = r.d.comment;
  r = await api('POST', `/posts/${P}/comments`, { token: alice.token, json: { text: 'Thanks Bob', parentComment: c1._id } });
  check('reply to comment', r.status === 201 && r.d.comment.parentComment === c1._id, r.body);
  const reply1 = r.d.comment;
  r = await api('POST', `/comments/${reply1._id}/replies`, { token: bob.token, json: { text: 'Welcome' } });
  check('reply to a reply is attached to the top-level comment', r.status === 201 && r.d.comment.parentComment === c1._id, r.body);
  r = await api('GET', '/notifications', { token: alice.token });
  check('post owner notified about comments', r.d.notifications.filter((n) => n.type === 'comment').length >= 2, r.d.notifications.map((n) => n.type));
  r = await api('GET', '/notifications', { token: bob.token });
  check('comment author notified about reply', r.d.notifications.some((n) => n.type === 'reply'), r.d.notifications.map((n) => n.type));
  r = await api('GET', `/posts/${P}`, { token: bob.token });
  check('post commentsCount updated (4)', r.d.post.commentsCount === 4, r.d.post.commentsCount);
  r = await api('GET', `/posts/${P}/comments?limit=1`, { token: dave.token });
  check('top-level comments paginated, newest first', r.status === 200 && r.d.comments.length === 1 && r.d.comments[0]._id === c2._id && r.meta.total === 2 && r.meta.hasNextPage);
  r = await api('GET', `/posts/${P}/comments?sort=oldest`, { token: dave.token });
  check('comments sort=oldest + repliesCount', r.d.comments[0]._id === c1._id && r.d.comments[0].repliesCount === 2);
  r = await api('GET', `/comments/${c1._id}/replies`, { token: dave.token });
  check('get replies of a comment', r.status === 200 && r.d.comments.length === 2);
  r = await api('PUT', `/comments/${c1._id}`, { token: carol.token, json: { text: 'edit' } });
  check("cannot edit others' comment -> 403", r.status === 403);
  r = await api('PUT', `/comments/${c1._id}`, { token: bob.token, json: { text: 'Nice picture!' } });
  check('edit own comment', r.status === 200 && r.d.comment.text === 'Nice picture!' && r.d.comment.isEdited === true);
  r = await api('DELETE', `/comments/${c2._id}`, { token: bob.token });
  check("cannot delete others' comment -> 403", r.status === 403);
  r = await api('POST', `/comments/${c1._id}/like`, { token: alice.token });
  check('like a comment', r.status === 200 && r.d.likesCount === 1);
  r = await api('POST', `/comments/${c1._id}/like`, { token: alice.token });
  check('comment like is idempotent', r.d.likesCount === 1);
  r = await api('GET', `/posts/${P}/comments?sort=oldest`, { token: alice.token });
  check('comment shows isLiked for viewer', r.d.comments[0].isLiked === true && r.d.comments[0].likesCount === 1);
  r = await api('DELETE', `/comments/${c1._id}/like`, { token: alice.token });
  check('unlike comment', r.status === 200 && r.d.likesCount === 0);
  r = await api('DELETE', `/comments/${c1._id}`, { token: bob.token });
  check('delete own comment (with its 2 replies)', r.status === 200);
  r = await api('GET', `/posts/${P}`, { token: bob.token });
  check('post commentsCount back to 1 after deleting comment + replies', r.d.post.commentsCount === 1, r.d.post.commentsCount);
  r = await api('DELETE', `/comments/${c2._id}`, { token: adminToken });
  check('admin can delete any comment', r.status === 200);
  r = await api('GET', `/posts/${P}`, { token: bob.token });
  check('commentsCount 0', r.d.post.commentsCount === 0);

  /* ---------------------------------------------------------------- */
  section('Follow / unfollow');
  r = await api('POST', `/users/${alice.id}/follow`, { token: alice.token });
  check('cannot follow yourself', r.status === 400);
  r = await api('POST', `/users/${alice.id}/follow`, { token: bob.token });
  check('follow user', r.status === 201 && r.d.isFollowing === true && r.d.followersCount === 1, r.body);
  r = await api('POST', `/users/${alice.id}/follow`, { token: bob.token });
  check('duplicate follow -> 409', r.status === 409);
  await Promise.all([1, 2, 3, 4, 5].map(() => api('POST', `/users/${alice.id}/follow`, { token: carol.token })));
  r = await api('GET', `/users/${alice.id}`, { token: bob.token });
  check('parallel follow requests -> counted once', r.d.user.followersCount === 2 && r.d.user.isFollowing === true, r.d.user.followersCount);
  r = await api('GET', `/users/${bob.id}`, { token: bob.token });
  check('following count updated', r.d.user.followingCount === 1);
  r = await api('GET', `/users/${alice.id}/follow-status`, { token: bob.token });
  check('check follow status', r.d.isFollowing === true && r.d.followStatus === 'accepted');
  r = await api('GET', `/users/${alice.id}/followers`, { token: dave.token });
  check('followers list', r.status === 200 && r.d.users.length === 2 && r.d.total === 2 && r.d.users[0].followStatus === 'none');
  r = await api('GET', `/users/${bob.id}/following`, { token: dave.token });
  check('following list', r.status === 200 && r.d.users.length === 1 && r.d.users[0]._id === alice.id);
  r = await api('DELETE', `/users/${alice.id}/follow`, { token: carol.token });
  check('unfollow', r.status === 200 && r.d.followersCount === 1, r.body);
  r = await api('DELETE', `/users/${alice.id}/follow`, { token: carol.token });
  check('unfollow when not following -> 404', r.status === 404);
  r = await api('GET', `/feed?following=true`, { token: bob.token });
  check('feed ?following=true shows followed users only', r.status === 200 && r.d.posts.every((p) => p.author._id === alice.id || p.author._id === bob.id));

  /* ---------------------------------------------------------------- */
  section('Notifications');
  r = await api('GET', '/notifications', { token: alice.token });
  const types = r.d.notifications.map((n) => n.type);
  check('alice got follow and like notifications', ['follow', 'like'].every((t) => types.includes(t)), types);
  check('notification has sender info + message', !!r.d.notifications[0].sender.firstName && !!r.d.notifications[0].message);
  const unread = r.d.unreadCount;
  r = await api('GET', '/notifications/unread-count', { token: alice.token });
  check('unread count', r.d.unreadCount === unread && unread > 0);
  r = await api('GET', '/notifications', { token: alice.token });
  const nid = r.d.notifications[0]._id;
  r = await api('PATCH', `/notifications/${nid}/read`, { token: alice.token });
  check('mark one notification read', r.status === 200 && r.d.notification.isRead === true);
  r = await api('PATCH', `/notifications/${nid}/read`, { token: bob.token });
  check("cannot touch someone else's notification", r.status === 404);
  r = await api('PATCH', '/notifications/read-all', { token: alice.token });
  r = await api('GET', '/notifications/unread-count', { token: alice.token });
  check('mark all read', r.d.unreadCount === 0);
  r = await api('POST', `/posts/${post2._id}/like`, { token: alice.token });
  r = await api('GET', '/notifications/unread-count', { token: alice.token });
  check('liking own post does not notify yourself', r.d.unreadCount === 0);
  await api('DELETE', `/posts/${post2._id}/like`, { token: alice.token });
  r = await api('GET', '/notifications', { token: alice.token });
  const delId = r.d.notifications[0]._id;
  r = await api('DELETE', `/notifications/${delId}`, { token: alice.token });
  check('delete notification', r.status === 200);

  /* ---------------------------------------------------------------- */
  section('Saved posts / share / report');
  r = await api('POST', `/posts/${P}/save`, { token: bob.token });
  check('save post', r.status === 200 && r.d.isSaved === true);
  r = await api('POST', `/posts/${P}/save`, { token: bob.token });
  check('saving twice is harmless', r.status === 200);
  r = await api('GET', '/users/me/saved', { token: bob.token });
  check('saved posts list', r.status === 200 && r.d.posts.length === 1 && r.d.posts[0].isSaved === true);
  r = await api('DELETE', `/posts/${P}/save`, { token: bob.token });
  r = await api('GET', '/users/me/saved', { token: bob.token });
  check('unsave post', r.d.posts.length === 0);
  r = await api('POST', `/posts/${P}/share`, { token: bob.token });
  check('share post returns link + counts share', r.status === 200 && r.d.shareUrl.includes(P) && r.d.sharesCount === 1);

  r = await api('POST', `/posts/${P}/report`, { token: alice.token, json: { reason: 'spam' } });
  check('cannot report own post', r.status === 400);
  r = await api('POST', `/posts/${P}/report`, { token: bob.token, json: { reason: 'bogus' } });
  check('invalid report reason -> 422', r.status === 422);
  r = await api('POST', `/posts/${P}/report`, { token: bob.token, json: { reason: 'spam', description: 'looks like spam' } });
  check('report post', r.status === 201);
  r = await api('POST', `/posts/${P}/report`, { token: bob.token, json: { reason: 'spam' } });
  check('duplicate report -> 409', r.status === 409);

  /* ---------------------------------------------------------------- */
  section('Admin: moderation (reports, hide/unhide)');
  r = await api('GET', '/admin/reports?status=pending', { token: adminToken });
  const rep = r.d.reports.find((x) => x.post?._id === P);
  check('admin sees pending report', r.status === 200 && !!rep, r.body);
  r = await api('PATCH', `/admin/reports/${rep._id}`, { token: adminToken, json: { status: 'action_taken', hidePost: true } });
  check('admin resolves report and hides post', r.status === 200 && r.d.report.status === 'action_taken');
  r = await api('GET', `/posts/${P}`, { token: bob.token });
  check('hidden post -> 404 for other users', r.status === 404);
  r = await api('GET', '/feed?limit=50', { token: bob.token });
  check('hidden post not in feed', !r.d.posts.some((p) => p._id === P));
  r = await api('GET', `/posts/${P}`, { token: alice.token });
  check('owner can still see own hidden post', r.status === 200 && r.d.post.isHidden === true);
  r = await api('POST', `/posts/${P}/like`, { token: bob.token });
  check('cannot react to hidden post', r.status === 404);
  r = await api('PATCH', `/admin/posts/${P}/unhide`, { token: adminToken });
  check('admin unhides post', r.status === 200 && r.d.post.isHidden === false);
  r = await api('PATCH', `/admin/posts/${P}/hide`, { token: adminToken, json: { reason: 'inappropriate' } });
  check('admin hides post manually', r.status === 200 && r.d.post.isHidden === true && r.d.post.hiddenReason === 'inappropriate');
  await api('PATCH', `/admin/posts/${P}/unhide`, { token: adminToken });

  /* ---------------------------------------------------------------- */
  section('Private accounts & follow requests');
  r = await api('POST', '/posts', { token: carol.token, form: postForm({ caption: 'carol secret' }, 1) });
  const carolPost = r.d.post;
  r = await api('PUT', '/users/me', { token: carol.token, json: { isPrivate: true } });
  check('set account private', r.status === 200 && r.d.user.isPrivate === true);
  r = await api('GET', '/feed?limit=50', { token: bob.token });
  check("private user's posts hidden from non-followers' feed", !r.d.posts.some((p) => p._id === carolPost._id));
  r = await api('GET', `/posts/${carolPost._id}`, { token: bob.token });
  check('private post direct access -> 403', r.status === 403);
  r = await api('GET', `/users/${carol.id}/posts`, { token: bob.token });
  check("private user's posts endpoint -> 403", r.status === 403);
  r = await api('GET', `/users/${carol.id}`, { token: bob.token });
  check('private profile is visible but locked', r.status === 200 && r.d.user.isLocked === true);
  r = await api('POST', `/users/${carol.id}/follow`, { token: bob.token });
  check('following private account -> pending request', r.status === 201 && r.d.followStatus === 'pending' && r.d.followersCount === 0, r.body);
  r = await api('POST', `/users/${carol.id}/follow`, { token: bob.token });
  check('duplicate follow request -> 409', r.status === 409);
  await api('POST', `/users/${carol.id}/follow`, { token: dave.token });
  r = await api('GET', '/users/me/follow-requests', { token: carol.token });
  check('private user sees follow requests', r.status === 200 && r.d.users.length === 2);
  r = await api('POST', `/users/me/follow-requests/${bob.id}/accept`, { token: carol.token });
  check('accept follow request', r.status === 200 && r.d.followersCount === 1);
  r = await api('POST', `/users/me/follow-requests/${bob.id}/accept`, { token: carol.token });
  check('accepting twice -> 404', r.status === 404);
  r = await api('POST', `/users/me/follow-requests/${dave.id}/reject`, { token: carol.token });
  check('reject follow request', r.status === 200);
  r = await api('GET', `/posts/${carolPost._id}`, { token: bob.token });
  check('accepted follower can see private post', r.status === 200);
  r = await api('GET', '/feed?limit=50', { token: bob.token });
  check('accepted follower sees private posts in feed', r.d.posts.some((p) => p._id === carolPost._id));
  r = await api('GET', `/users/${bob.id}`, { token: bob.token });
  check("bob's following count includes accepted request only", r.d.user.followingCount === 2, r.d.user.followingCount);
  r = await api('GET', '/notifications', { token: bob.token });
  check('bob got "follow request accepted" notification', r.d.notifications.some((n) => n.type === 'follow_accepted'));
  // go public again -> pending auto accepted
  await api('POST', `/users/${carol.id}/follow`, { token: dave.token });
  r = await api('PUT', '/users/me', { token: carol.token, json: { isPrivate: false } });
  r = await api('GET', `/users/${carol.id}`, { token: dave.token });
  check('switching to public auto-accepts pending requests', r.d.user.followStatus === 'accepted' && r.d.user.followersCount === 2, r.d.user);

  /* ---------------------------------------------------------------- */
  section('User-to-user block');
  r = await api('POST', `/users/${bob.id}/block`, { token: alice.token });
  check('block user', r.status === 200);
  r = await api('GET', `/users/${alice.id}`, { token: bob.token });
  check('blocked user cannot see blocker profile -> 404', r.status === 404);
  r = await api('GET', `/posts/${P}`, { token: bob.token });
  check('blocked user cannot see blocker posts -> 404', r.status === 404);
  r = await api('GET', '/feed?limit=50', { token: bob.token });
  check("blocker's posts removed from blocked user's feed", !r.d.posts.some((p) => p.author._id === alice.id));
  r = await api('POST', `/users/${alice.id}/follow`, { token: bob.token });
  check('blocked user cannot follow blocker', r.status === 404);
  r = await api('GET', `/users/${alice.id}`, { token: alice.token });
  check('block removed follow relations & fixed counters', r.d.user.followersCount === 0, r.d.user.followersCount);
  r = await api('GET', '/users/me/blocked', { token: alice.token });
  check('blocked users list', r.d.users.length === 1 && r.d.users[0]._id === bob.id);
  r = await api('POST', `/users/${alice.id}/block`, { token: alice.token });
  check('cannot block yourself', r.status === 400);
  r = await api('POST', `/users/${adminId}/block`, { token: alice.token });
  check('cannot block admin', r.status === 403);
  r = await api('DELETE', `/users/${bob.id}/block`, { token: alice.token });
  r = await api('GET', `/users/${alice.id}`, { token: bob.token });
  check('unblock restores visibility', r.status === 200);

  /* ---------------------------------------------------------------- */
  section('Admin: dashboard & user management');
  r = await api('GET', '/admin/dashboard', { token: adminToken });
  const st = r.d.stats;
  check('dashboard stats present', ['totalUsers', 'totalAdmins', 'totalPosts', 'totalComments', 'totalLikes', 'totalFollowers'].every((k) => typeof st[k] === 'number'), st);
  check('dashboard: at least 1 admin and >= 5 users', st.totalAdmins >= 1 && st.totalUsers >= 5);
  r = await api('GET', '/admin/users?limit=2&page=1', { token: adminToken });
  check('admin: list users with pagination', r.status === 200 && r.d.users.length === 2 && r.meta.total >= 5);
  check('admin list includes email & mobile but never password', r.d.users.every((u) => u.email && u.mobile && u.password === undefined));
  r = await api('GET', `/admin/users?search=${encodeURIComponent(bob.data.email.split('@')[0])}`, { token: adminToken });
  check('admin: search users', r.d.users.length === 1 && r.d.users[0]._id === bob.id);
  r = await api('GET', '/admin/users?role=admin', { token: adminToken });
  check('admin: filter by role', r.d.users.every((u) => u.role === 'admin') && r.d.users.length >= 1);
  r = await api('GET', `/admin/users/${alice.id}`, { token: adminToken });
  check('admin: view single user', r.status === 200 && r.d.user._id === alice.id && typeof r.d.user.commentsCount === 'number');
  r = await api('PUT', `/admin/users/${alice.id}`, { token: adminToken, json: { firstName: 'AliceUpdated', bio: 'edited by admin' } });
  check('admin: update user', r.status === 200 && r.d.user.firstName === 'AliceUpdated');
  r = await api('GET', `/admin/users/${alice.id}/posts`, { token: adminToken });
  check('admin: view user posts', r.status === 200 && r.d.posts.length === 2);
  r = await api('GET', `/admin/users/${alice.id}/followers`, { token: adminToken });
  check('admin: view user followers', r.status === 200);
  r = await api('GET', `/admin/users/${bob.id}/following`, { token: adminToken });
  check('admin: view user following', r.status === 200 && r.d.users.length >= 1);

  r = await api('PATCH', `/admin/users/${mallory.id}/block`, { token: adminToken, json: { reason: 'spamming' } });
  check('admin: block user', r.status === 200 && r.d.user.isBlocked === true);
  r = await api('GET', '/auth/me', { token: mallory.token });
  check('blocked user: existing token stops working', r.status === 403);
  r = await api('POST', '/auth/login', { json: { email: roleInject.d.user.email, password: 'Passw0rd123' } });
  check('blocked user cannot log in', r.status === 403);
  r = await api('PATCH', `/admin/users/${mallory.id}/unblock`, { token: adminToken });
  check('admin: unblock user', r.status === 200 && r.d.user.isBlocked === false);
  r = await api('GET', '/auth/me', { token: mallory.token });
  check('unblocked user works again', r.status === 200);

  r = await api('PATCH', `/admin/users/${mallory.id}/role`, { token: adminToken, json: { role: 'superuser' } });
  check('invalid role -> 422', r.status === 422);
  r = await api('PATCH', `/admin/users/${mallory.id}/role`, { token: adminToken, json: { role: 'admin' } });
  check('admin: promote user to admin', r.status === 200 && r.d.user.role === 'admin');
  r = await api('GET', '/admin/dashboard', { token: mallory.token });
  check('promoted user can access admin routes', r.status === 200);
  r = await api('PATCH', `/admin/users/${mallory.id}/role`, { token: adminToken, json: { role: 'user' } });
  check('admin: demote back to user', r.status === 200 && r.d.user.role === 'user');
  r = await api('PATCH', `/admin/users/${adminId}/role`, { token: adminToken, json: { role: 'user' } });
  check('admin cannot demote themselves', r.status === 400);
  r = await api('DELETE', `/admin/users/${adminId}`, { token: adminToken });
  check('admin cannot delete themselves', r.status === 400);
  r = await api('PATCH', `/admin/users/${adminId}/block`, { token: adminToken });
  check('admin cannot block themselves', r.status === 400);

  /* ---------------------------------------------------------------- */
  section('Admin: posts & comments management');
  r = await api('GET', '/admin/posts?limit=3', { token: adminToken });
  check('admin: list all posts', r.status === 200 && r.d.posts.length >= 1 && r.meta.total >= 3);
  r = await api('GET', `/admin/posts/${P}`, { token: adminToken });
  check('admin: view single post', r.status === 200);
  r = await api('POST', '/admin/posts', { token: adminToken, form: postForm({ caption: 'Admin post', location: 'HQ' }, 1) });
  check('admin: create post', r.status === 201 && r.d.post.caption === 'Admin post', r.body);
  const adminPost = r.d.post;
  r = await api('PUT', `/admin/posts/${P}`, { token: adminToken, form: postForm({ caption: 'Admin edited caption' }, 0) });
  check("admin: update any user's post", r.status === 200 && r.d.post.caption === 'Admin edited caption', r.body);
  r = await api('DELETE', `/admin/posts/${adminPost._id}`, { token: adminToken });
  check('admin: delete post', r.status === 200);
  // comments
  r = await api('POST', `/posts/${P}/comments`, { token: carol.token, json: { text: 'badword here' } });
  const badComment = r.d.comment;
  r = await api('GET', '/admin/comments?search=badword', { token: adminToken });
  check('admin: list/search comments', r.status === 200 && r.d.comments.length === 1);
  r = await api('PATCH', `/admin/comments/${badComment._id}/hide`, { token: adminToken, json: { reason: 'abuse' } });
  check('admin: hide comment', r.status === 200 && r.d.comment.isHidden === true);
  r = await api('GET', `/posts/${P}/comments`, { token: bob.token });
  check('hidden comment not shown to users', !r.d.comments.some((c) => c._id === badComment._id));
  r = await api('DELETE', `/admin/comments/${badComment._id}`, { token: adminToken });
  check('admin: delete comment', r.status === 200);
  r = await api('GET', `/posts/${P}`, { token: bob.token });
  check('post commentsCount correct after admin delete', r.d.post.commentsCount === 0, r.d.post.commentsCount);

  /* ---------------------------------------------------------------- */
  section('Delete post cascade & delete own post');
  r = await api('POST', '/posts', { token: bob.token, form: postForm({ caption: 'bob to delete' }, 2) });
  const bobPost = r.d.post;
  await api('POST', `/posts/${bobPost._id}/like`, { token: carol.token });
  await api('POST', `/posts/${bobPost._id}/comments`, { token: carol.token, json: { text: 'hi' } });
  await api('POST', `/posts/${bobPost._id}/save`, { token: carol.token });
  r = await api('DELETE', `/posts/${bobPost._id}`, { token: carol.token });
  check("cannot delete someone else's post -> 403", r.status === 403);
  r = await api('DELETE', `/posts/${bobPost._id}`, { token: bob.token });
  check('delete own post', r.status === 200);
  r = await api('GET', `/posts/${bobPost._id}`, { token: bob.token });
  check('deleted post is gone', r.status === 404);
  img = await fetch(bobPost.images[0].url);
  check('post image files removed from disk', img.status === 404);
  r = await api('GET', '/users/me/saved', { token: carol.token });
  check('saved entries cleaned up', r.d.posts.length === 0);
  r = await api('GET', '/users/me', { token: bob.token });
  check('author postsCount decremented', r.d.user.postsCount === 0, r.d.user.postsCount);
  r = await api('POST', '/posts', { token: carol.token, form: postForm({ caption: 'user deletes by admin' }, 1) });
  r = await api('DELETE', `/posts/${r.d.post._id}`, { token: adminToken });
  check('admin can delete any post through normal route too', r.status === 200);

  /* ---------------------------------------------------------------- */
  section('Admin: delete user (cascade)');
  // set up relations around dave
  r = await api('POST', '/posts', { token: dave.token, form: postForm({ caption: 'dave post' }, 1) });
  const davePost = r.d.post;
  await api('POST', `/posts/${P}/like`, { token: dave.token });
  await api('POST', `/posts/${P}/comments`, { token: dave.token, json: { text: 'dave was here' } });
  await api('POST', `/users/${alice.id}/follow`, { token: dave.token });
  await api('POST', `/users/${dave.id}/follow`, { token: bob.token });
  r = await api('GET', `/posts/${P}`, { token: bob.token });
  const before = r.d.post;
  r = await api('GET', `/users/${alice.id}`, { token: bob.token });
  const aliceFollowersBefore = r.d.user.followersCount;
  r = await api('DELETE', `/admin/users/${dave.id}`, { token: adminToken });
  check('admin: delete user', r.status === 200, r.body);
  r = await api('GET', '/auth/me', { token: dave.token });
  check('deleted user token stops working', r.status === 401);
  r = await api('GET', `/posts/${P}`, { token: bob.token });
  check("deleted user's like & comment removed from post counts", r.d.post.likesCount === before.likesCount - 1 && r.d.post.commentsCount === before.commentsCount - 1, [r.d.post.likesCount, before.likesCount, r.d.post.commentsCount, before.commentsCount]);
  r = await api('GET', `/users/${alice.id}`, { token: bob.token });
  check("deleted user's follows removed from other users' counters", r.d.user.followersCount === aliceFollowersBefore - 1);
  r = await api('GET', `/users/${bob.id}`, { token: bob.token });
  check('followers of deleted user: following count fixed', r.d.user.followingCount === 1, r.d.user.followingCount);
  r = await api('GET', `/posts/${davePost._id}`, { token: bob.token });
  check("deleted user's posts removed", r.status === 404);
  r = await api('POST', '/auth/login', { json: { email: dave.data.email, password: dave.data.password } });
  check('deleted user cannot log in', r.status === 401);

  /* ---------------------------------------------------------------- */
  section('Misc security');
  r = await api('GET', '/posts/not-an-id', { token: alice.token });
  check('invalid ObjectId in URL -> 422', r.status === 422);
  r = await api('POST', `/posts/${P}/comments`, { token: alice.token, json: { text: 'x'.repeat(1001) } });
  check('comment too long -> 422', r.status === 422);
  r = await api('POST', '/posts', { token: alice.token, form: postForm({ caption: 'x'.repeat(2300) }, 1) });
  check('caption too long -> 422 (and upload cleaned)', r.status === 422);
  r = await api('POST', '/auth/login', { json: { email: alice.data.email, password: alice.data.password, $where: '1==1' } });
  check('operator keys in body are stripped', r.status === 200);

  console.log(`\n${'-'.repeat(60)}\nPassed: ${passed}   Failed: ${failed}`);
  if (failed) {
    console.log('Failures:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
})().catch((e) => {
  console.error('Test run crashed:', e);
  process.exit(1);
});
