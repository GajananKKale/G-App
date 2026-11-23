import mongoose from 'mongoose';
import env from '../config/env.js';

// Runs fn(session). Uses a real MongoDB transaction when USE_TRANSACTIONS=true
// (requires a replica set / Atlas); otherwise fn receives null and runs normally.
export const withTransaction = async (fn) => {
  if (!env.useTransactions) return fn(null);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};
