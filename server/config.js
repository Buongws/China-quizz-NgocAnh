import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGODB_URI || '',
  jwtSecret: process.env.JWT_SECRET || '',
  clientOrigins: String(process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  adminDefaultPassword: process.env.ADMIN_DEFAULT_PASSWORD || '123456',
  adminUsernames: String(process.env.ADMIN_USERNAMES || process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
};

export function assertServerConfig() {
  const missing = [];

  if (!config.mongoUri) missing.push('MONGODB_URI');
  if (!config.jwtSecret) missing.push('JWT_SECRET');

  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

export function isAdminUsername(username) {
  return config.adminUsernames.includes(String(username || '').trim().toLowerCase());
}

// Backward-compatible alias (older code imported isAdminEmail).
export const isAdminEmail = isAdminUsername;
