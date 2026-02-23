import { verifyAuthToken } from '../lib/jwt.js';
import { User } from '../models/User.js';

export async function authRequired(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : '';

    if (!token) {
      return res.status(401).json({ message: 'Thiếu token đăng nhập.' });
    }

    const payload = verifyAuthToken(token);
    const user = await User.findById(payload.sub).lean();

    if (!user) {
      return res.status(401).json({ message: 'Tài khoản không tồn tại.' });
    }

    req.authUser = {
      id: String(user._id),
      username: user.username || '',
      email: user.email || '',
      displayName: user.displayName || '',
      role: user.role || 'student',
    };

    return next();
  } catch {
    return res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn.' });
  }
}
