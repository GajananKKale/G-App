import Follow from '../models/Follow.js';
import { incUser } from '../utils/counters.js';
import { withTransaction } from '../utils/transaction.js';
import { notify, removeNotification } from './notification.service.js';

// Create a follow relation (accepted for public accounts, pending for private ones).
export const createFollow = async (me, target) => {
  const status = target.isPrivate ? 'pending' : 'accepted';
  await withTransaction(async (session) => {
    await Follow.create([{ follower: me._id, following: target._id, status }], { session });
    if (status === 'accepted') {
      await incUser(me._id, 'followingCount', 1, session);
      await incUser(target._id, 'followersCount', 1, session);
    }
  });
  await notify({ recipient: target._id, sender: me, type: status === 'accepted' ? 'follow' : 'follow_request' });
  return status;
};

// Removes a follow relation / pending request and fixes the counters. Returns the deleted doc (or null).
export const removeFollow = async (followerId, followingId) => {
  const removed = await withTransaction(async (session) => {
    const doc = await Follow.findOneAndDelete({ follower: followerId, following: followingId }, { session });
    if (doc && doc.status === 'accepted') {
      await incUser(followerId, 'followingCount', -1, session);
      await incUser(followingId, 'followersCount', -1, session);
    }
    return doc;
  });
  if (removed) await removeNotification({ sender: followerId, recipient: followingId, type: { $in: ['follow', 'follow_request'] } });
  return removed;
};

export const removeFollowBetween = async (a, b) => {
  await removeFollow(a, b);
  await removeFollow(b, a);
};

export const acceptFollowRequest = async (me, followerUser) => {
  const accepted = await withTransaction(async (session) => {
    const doc = await Follow.findOneAndUpdate(
      { follower: followerUser._id, following: me._id, status: 'pending' },
      { $set: { status: 'accepted' } },
      { returnDocument: 'after', session }
    );
    if (doc) {
      await incUser(followerUser._id, 'followingCount', 1, session);
      await incUser(me._id, 'followersCount', 1, session);
    }
    return doc;
  });
  if (accepted) {
    await removeNotification({ recipient: me._id, sender: followerUser._id, type: 'follow_request' });
    await notify({ recipient: followerUser._id, sender: me, type: 'follow_accepted' });
  }
  return accepted;
};

// Called when a private account becomes public: every pending request is accepted.
export const acceptAllPending = async (me) => {
  const pending = await Follow.find({ following: me._id, status: 'pending' });
  for (const p of pending) {
    await withTransaction(async (session) => {
      const doc = await Follow.findOneAndUpdate({ _id: p._id, status: 'pending' }, { $set: { status: 'accepted' } }, { session });
      if (doc) {
        await incUser(p.follower, 'followingCount', 1, session);
        await incUser(me._id, 'followersCount', 1, session);
      }
    });
  }
  await removeNotification({ recipient: me._id, type: 'follow_request' });
  return pending.length;
};
