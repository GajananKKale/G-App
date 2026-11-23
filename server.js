import app from './app.js';
import env from './config/env.js';
import { connectDB } from './config/db.js';
import { ensureAdmin } from './services/seed.service.js';
import { verifyStorage } from './services/storage.service.js';

const start = async () => {
  await connectDB();
  await verifyStorage();

  if (env.seedAdmin) {
    try {
      const { admin, created } = await ensureAdmin();
      if (created) console.log(`Default admin created -> email: ${admin.email} | mobile: ${admin.mobile} | password: (value of ADMIN_PASSWORD in .env)`);
    } catch (err) {
      console.error('Admin seeding failed:', err.message);
    }
  }

  const server = app.listen(env.port, () => console.log(`Server running in ${env.nodeEnv} mode on port ${env.port}`));

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
start();
