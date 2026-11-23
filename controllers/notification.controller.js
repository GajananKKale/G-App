import Notification from '../models/Notification.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { getPagination, buildMeta } from '../utils/pagination.js';
import { BRIEF_USER_FIELDS } from '../services/serializer.service.js';

// GET /api/notifications?unread=true
export const getNotifications = asyncHandler(async (req, res) => {
  const pg = getPagination(req, { defaultLimit: 20 });
  const filter = { recipient: req.user._id };
  if (req.query.unread === 'true') filter.isRead = false;
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).populate('sender', BRIEF_USER_FIELDS),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipient: req.user._id, isRead: false }),
  ]);
  return sendSuccess(res, { message: 'Notifications fetched', data: { notifications: items, unreadCount }, meta: buildMeta(pg, total) });
});

// GET /api/notifications/unread-count
export const getUnreadCount = asyncHandler(async (req, res) => {
  const unreadCount = await Notification.countDocuments({ recipient: req.user._id, isRead: false });
  return sendSuccess(res, { message: 'Unread count fetched', data: { unreadCount } });
});

// PATCH /api/notifications/read-all
export const markAllRead = asyncHandler(async (req, res) => {
  const r = await Notification.updateMany({ recipient: req.user._id, isRead: false }, { $set: { isRead: true } });
  return sendSuccess(res, { message: 'All notifications marked as read', data: { updated: r.modifiedCount } });
});

// PATCH /api/notifications/:id/read
export const markRead = asyncHandler(async (req, res) => {
  const n = await Notification.findOneAndUpdate({ _id: req.params.id, recipient: req.user._id }, { $set: { isRead: true } }, { returnDocument: 'after' });
  if (!n) throw new ApiError(404, 'Notification not found');
  return sendSuccess(res, { message: 'Notification marked as read', data: { notification: n } });
});

// DELETE /api/notifications/:id
export const deleteNotification = asyncHandler(async (req, res) => {
  const r = await Notification.deleteOne({ _id: req.params.id, recipient: req.user._id });
  if (!r.deletedCount) throw new ApiError(404, 'Notification not found');
  return sendSuccess(res, { message: 'Notification deleted' });
});
