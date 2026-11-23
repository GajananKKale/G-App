// Usage: npm run seed:admin   (creates the admin or resets its password to ADMIN_PASSWORD from .env)
import env from '../config/env.js';
import { connectDB, disconnectDB } from '../config/db.js';
import { ensureAdmin } from '../services/seed.service.js';

await connectDB();
const { admin, created } = await ensureAdmin({ resetPassword: true });
console.log(created ? 'Admin created' : 'Admin already existed – password reset to value in .env');
console.log(`  email:    ${admin.email}`);
console.log(`  mobile:   ${admin.mobile}`);
console.log(`  password: ${env.admin.password}`);
await disconnectDB();
