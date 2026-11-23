import Notification from '../models/Notification.js';

const MESSAGES = {
  follow: (n) => `${n} started following you`,
  follow_request: (n) => `${n} requested to follow you`,
  follow_accepted: (n) => `${n} accepted your follow request`,
  like: (n) => `${n} liked your post`,
  comment: (n) => `${n} commented on your post`,
  reply: (n) => `${n} replied to your comment`,
  comment_like: (n) => `${n} liked your comment`,
};

// Fire-and-forget: a failed notification must never fail the main request.
export const notify = async ({ recipient, sender, type, post, comment }) => {
  try {
    if (!recipient || String(recipient) === String(sender._id)) return null;
    const message = MESSAGES[type](sender.fullName || `${sender.firstName} ${sender.lastName}`);
    const filter = { recipient, sender: sender._id, type };
    if (post) filter.post = post;
    if (comment) filter.comment = comment;
    const doc = await Notification.findOneAndUpdate(
      filter,
      { $set: { message, isRead: false } },
      { upsert: true, returnDocument: 'after' }
    );
    return doc;
  } catch (err) {
    console.error('[NOTIFY ERROR]', err.message);
    return null;
  }
};

export const removeNotification = async (filter) => {
  try {
    await Notification.deleteMany(filter);
  } catch (err) {
    console.error('[NOTIFY ERROR]', err.message);
  }
};
