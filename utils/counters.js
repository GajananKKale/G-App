import User from '../models/User.js';

// Atomically adjust a denormalised counter on a user (never goes below 0).
export const incUser = (id, field, n = 1, session = null) => {
  const filter = n < 0 ? { _id: id, [field]: { $gt: 0 } } : { _id: id };
  return User.updateOne(filter, { $inc: { [field]: n } }, { session });
};

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const parseList = (v) => {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('[')) {
      try {
        const arr = JSON.parse(t);
        if (Array.isArray(arr)) return arr.map(String);
      } catch {
        /* fall through */
      }
    }
    return t.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
};
