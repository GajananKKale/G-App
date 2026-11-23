import mongoose from 'mongoose';
import env from './env.js';

mongoose.set('strictQuery', true);

export const connectDB = async () => {
  try {
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000 });
    console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
    // make sure every unique / TTL index exists before serving traffic
    await mongoose.syncIndexes();
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  }
};

export const disconnectDB = () => mongoose.disconnect();
