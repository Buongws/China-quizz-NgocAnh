import express from 'express';
import { authRequired } from '../middleware/authRequired.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { User } from '../models/User.js';
import { serializeUser } from '../utils/serialize.js';

const router = express.Router();

router.patch(
  '/me/profile',
  authRequired,
  asyncHandler(async (req, res) => {
    const displayName = String(req.body?.displayName || '').trim();

    if (displayName.length < 2) {
      return res.status(400).json({ message: 'Tên tối thiểu 2 ký tự.' });
    }

    if (displayName.length > 60) {
      return res.status(400).json({ message: 'Tên tối đa 60 ký tự.' });
    }

    const user = await User.findByIdAndUpdate(
      req.authUser.id,
      { displayName },
      { new: true },
    );

    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản.' });
    }

    return res.json({ user: serializeUser(user) });
  }),
);

export { router as userRoutes };
