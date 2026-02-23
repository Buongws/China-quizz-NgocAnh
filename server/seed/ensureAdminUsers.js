import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { User } from '../models/User.js';

function buildInternalEmailFromUsername(username) {
  return username.includes('@') ? username : `${username}@local.quiz`;
}

export async function ensureAdminUsers() {
  if (!config.adminUsernames.length) {
    return;
  }

  for (const username of config.adminUsernames) {
    const passwordHash = await bcrypt.hash(config.adminDefaultPassword, 10);
    const email = buildInternalEmailFromUsername(username);

    const existing = await User.findOne({
      $or: [{ username }, { email }],
    });

    if (!existing) {
      await User.create({
        username,
        email,
        role: 'admin',
        displayName: 'Admin',
        passwordHash,
      });
      continue;
    }

    existing.username = username;
    existing.email = email;
    existing.role = 'admin';
    if (!existing.displayName) {
      existing.displayName = 'Admin';
    }
    existing.passwordHash = passwordHash;
    await existing.save();
  }
}
