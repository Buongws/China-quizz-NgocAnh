import express from 'express';
import bcrypt from 'bcryptjs';
import { asyncHandler } from '../utils/asyncHandler.js';
import { User } from '../models/User.js';
import { signAuthToken } from '../lib/jwt.js';
import { authRequired } from '../middleware/authRequired.js';
import { serializeUser } from '../utils/serialize.js';
import { isAdminUsername } from '../config.js';

const router = express.Router();

const USERNAME_REGEX = /^[a-z0-9._@-]{3,32}$/;

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function buildInternalEmailFromUsername(username) {
  return username.includes('@') ? username : `${username}@local.quiz`;
}

function validateUsername(username) {
  if (!username) {
    return 'Tên đăng nhập là bắt buộc.';
  }

  if (username.length < 3 || username.length > 32) {
    return 'Tên đăng nhập phải từ 3 đến 32 ký tự.';
  }

  if (!USERNAME_REGEX.test(username)) {
    return 'Tên đăng nhập chỉ được chứa chữ thường, số và các ký tự . _ - @';
  }

  if (/^[._@-]|[._@-]$/.test(username)) {
    return 'Tên đăng nhập không được bắt đầu hoặc kết thúc bằng ký tự đặc biệt.';
  }

  if (/([._@-])\1/.test(username)) {
    return 'Tên đăng nhập không được lặp ký tự đặc biệt liên tiếp.';
  }

  return null;
}

function validatePassword(password) {
  if (!password) {
    return 'Mật khẩu là bắt buộc.';
  }

  if (password.length < 6) {
    return 'Mật khẩu tối thiểu 6 ký tự.';
  }

  if (password.length > 128) {
    return 'Mật khẩu tối đa 128 ký tự.';
  }

  return null;
}

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    // Backward compatibility: still accept body.email from older frontend versions.
    const username = normalizeUsername(req.body?.username ?? req.body?.email);
    const password = String(req.body?.password || '');

    const usernameError = validateUsername(username);
    if (usernameError) {
      return res.status(400).json({ message: usernameError });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const internalEmail = buildInternalEmailFromUsername(username);

    const existed = await User.findOne({
      $or: [{ username }, { email: internalEmail }],
    }).lean();
    if (existed) {
      return res.status(409).json({ message: 'Tên đăng nhập đã tồn tại.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      email: internalEmail,
      passwordHash,
      displayName: '',
      role: isAdminUsername(username) ? 'admin' : 'student',
    });

    return res.status(201).json({
      token: signAuthToken({ sub: String(user._id) }),
      user: serializeUser(user),
    });
  }),
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    // Backward compatibility: accept body.email from old clients, but treat it as login name.
    const loginName = normalizeUsername(req.body?.username ?? req.body?.email);
    const password = String(req.body?.password || '');

    const usernameError = validateUsername(loginName);
    if (usernameError) {
      return res.status(400).json({ message: usernameError });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const user = await User.findOne({
      $or: [{ username: loginName }, { email: loginName }],
    });
    if (!user) {
      return res.status(401).json({ message: 'Sai tên đăng nhập hoặc mật khẩu.' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ message: 'Sai tên đăng nhập hoặc mật khẩu.' });
    }

    let shouldSave = false;

    if (!user.username) {
      user.username = loginName;
      shouldSave = true;
    }

    const normalizedUsername = normalizeUsername(user.username || loginName);
    const expectedInternalEmail = buildInternalEmailFromUsername(normalizedUsername);

    if (!user.email) {
      user.email = expectedInternalEmail;
      shouldSave = true;
    }

    const expectedRole = isAdminUsername(normalizedUsername) ? 'admin' : 'student';
    if ((user.role || 'student') !== expectedRole) {
      user.role = expectedRole;
      shouldSave = true;
    }

    if (shouldSave) {
      await user.save();
    }

    return res.json({
      token: signAuthToken({ sub: String(user._id) }),
      user: serializeUser(user),
    });
  }),
);

router.get(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.authUser.id);
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản.' });
    }

    return res.json({ user: serializeUser(user) });
  }),
);

export { router as authRoutes };
