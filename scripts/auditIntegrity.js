// Usage: node scripts/auditIntegrity.js
// Verifies that stored counters match the real data and that no uploaded file is orphaned.
import fs from 'fs';
import path from 'path';
import env from '../config/env.js';
import { connectDB, disconnectDB } from '../config/db.js';
import User from '../models/User.js';
import Post from '../models/Post.js';
import Comment from '../models/Comment.js';
import Reaction from '../models/Reaction.js';
import Follow from '../models/Follow.js';
import CommentLike from '../models/CommentLike.js';

await connectDB();
let problems = 0;
const bad = (msg) => { problems += 1; console.log('  ✘', msg); };

for (const u of await User.find().select('+password')) {
  if (!u.password.startsWith('$2')) bad(`user ${u.email} password is not a bcrypt hash`);
  const [posts, followers, following] = await Promise.all([
    Post.countDocuments({ author: u._id }),
    Follow.countDocuments({ following: u._id, status: 'accepted' }),
    Follow.countDocuments({ follower: u._id, status: 'accepted' }),
  ]);
  if (u.postsCount !== posts) bad(`user ${u.email}: postsCount ${u.postsCount} != ${posts}`);
  if (u.followersCount !== followers) bad(`user ${u.email}: followersCount ${u.followersCount} != ${followers}`);
  if (u.followingCount !== following) bad(`user ${u.email}: followingCount ${u.followingCount} != ${following}`);
}
for (const p of await Post.find()) {
  const [likes, dislikes, comments] = await Promise.all([
    Reaction.countDocuments({ post: p._id, type: 'like' }),
    Reaction.countDocuments({ post: p._id, type: 'dislike' }),
    Comment.countDocuments({ post: p._id }),
  ]);
  if (p.likesCount !== likes) bad(`post ${p._id}: likesCount ${p.likesCount} != ${likes}`);
  if (p.dislikesCount !== dislikes) bad(`post ${p._id}: dislikesCount ${p.dislikesCount} != ${dislikes}`);
  if (p.commentsCount !== comments) bad(`post ${p._id}: commentsCount ${p.commentsCount} != ${comments}`);
}
for (const c of await Comment.find()) {
  const [likes, replies] = await Promise.all([CommentLike.countDocuments({ comment: c._id }), Comment.countDocuments({ parentComment: c._id })]);
  if (c.likesCount !== likes) bad(`comment ${c._id}: likesCount ${c.likesCount} != ${likes}`);
  if (c.repliesCount !== replies) bad(`comment ${c._id}: repliesCount ${c.repliesCount} != ${replies}`);
}

// orphaned files
const referenced = new Set();
(await Post.find().select('images')).forEach((p) => p.images.forEach((i) => referenced.add(i.url)));
(await User.find().select('profilePicture')).forEach((u) => u.profilePicture && referenced.add(u.profilePicture));
for (const folder of ['posts', 'profiles']) {
  const dir = path.join(env.uploadDir, folder);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (f === '.gitkeep') continue;
    if (!referenced.has(`/uploads/${folder}/${f}`)) bad(`orphaned file uploads/${folder}/${f}`);
  }
}
for (const url of referenced) {
  if (!fs.existsSync(path.join(env.uploadDir, url.replace('/uploads/', '')))) bad(`missing file for ${url}`);
}

console.log(problems ? `Audit finished with ${problems} problem(s)` : 'Audit OK: counters, password hashes and files are all consistent');
await disconnectDB();
process.exit(problems ? 1 : 0);
