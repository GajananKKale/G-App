import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
import env from './config/env.js';
import routes from './routes/index.js';
import sanitizeInput from './middlewares/sanitize.js';
import { apiLimiter } from './middlewares/rateLimit.js';
import { notFound, errorHandler } from './middlewares/error.js';

const app = express();

if (env.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })); // images must be loadable from the app
app.use(
  cors({
    origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  })
);
if (env.nodeEnv !== 'test') app.use(morgan(env.isProd ? 'combined' : 'dev'));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(sanitizeInput);

fs.mkdirSync(env.uploadDir, { recursive: true });
app.use('/uploads', express.static(env.uploadDir, { maxAge: '7d', index: false }));

app.use('/api', apiLimiter, routes);
app.get('/', (req, res) => res.json({ success: true, message: 'Social Media API', docs: 'See README.md', health: '/api/health' }));

app.use(notFound);
app.use(errorHandler);

export default app;
