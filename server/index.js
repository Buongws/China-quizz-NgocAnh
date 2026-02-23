import express from 'express';
import cors from 'cors';
import { assertServerConfig, config } from './config.js';
import { connectToDatabase } from './lib/db.js';
import { ensureSeedData } from './seed/ensureSeedData.js';
import { ensureAdminUsers } from './seed/ensureAdminUsers.js';
import { authRoutes } from './routes/authRoutes.js';
import { userRoutes } from './routes/userRoutes.js';
import { categoryRoutes } from './routes/categoryRoutes.js';
import { quizRoutes } from './routes/quizRoutes.js';
import { scoreRoutes } from './routes/scoreRoutes.js';
import { adminDashboardRoutes } from './routes/adminDashboardRoutes.js';

const app = express();

app.disable('x-powered-by');
app.use(
  cors({
    origin: config.clientOrigin,
    credentials: false,
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'quiz-api' });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/scores', scoreRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);

app.use((req, res) => {
  res.status(404).json({ message: `Not found: ${req.method} ${req.path}` });
});

app.use((error, _req, res, _next) => {
  const status = Number(error?.statusCode || 500);
  const message =
    typeof error?.message === 'string' && error.message
      ? error.message
      : 'Internal server error';

  if (status >= 500) {
    console.error('[server error]', error);
  }

  res.status(status).json({ message });
});

async function start() {
  assertServerConfig();
  await connectToDatabase(config.mongoUri);
  await ensureAdminUsers();
  await ensureSeedData();

  app.listen(config.port, () => {
    console.log(`[quiz-api] listening at http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  console.error('[startup error]', error);
  process.exit(1);
});
