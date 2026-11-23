import User from '../models/User.js';
import env from '../config/env.js';

// Creates the default admin (password is hashed by the User model). Does nothing if it already exists.
export const ensureAdmin = async ({ resetPassword = false } = {}) => {
  const a = env.admin;
  let admin = await User.findOne({ email: a.email }).select('+password');
  if (admin) {
    let changed = false;
    if (admin.role !== 'admin') { admin.role = 'admin'; changed = true; }
    if (admin.isBlocked) { admin.isBlocked = false; changed = true; }
    if (resetPassword) { admin.password = a.password; changed = true; }
    if (changed) await admin.save();
    return { admin, created: false };
  }
  const mobileTaken = await User.exists({ mobile: a.mobile });
  if (mobileTaken) throw new Error(`Cannot seed admin: mobile ${a.mobile} already belongs to another user`);
  admin = await User.create({
    firstName: a.firstName, lastName: a.lastName, email: a.email, password: a.password, mobile: a.mobile,
    country: a.country, state: a.state, city: a.city, role: 'admin', isEmailVerified: true,
  });
  return { admin, created: true };
};
