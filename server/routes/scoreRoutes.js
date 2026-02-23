import express from 'express';
import mongoose from 'mongoose';
import { authRequired } from '../middleware/authRequired.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { Category } from '../models/Category.js';
import { Score } from '../models/Score.js';
import { serializeScore } from '../utils/serialize.js';

const router = express.Router();

router.get(
  '/me/summary',
  authRequired,
  asyncHandler(async (req, res) => {
    const summary = await Score.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(req.authUser.id),
        },
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
      {
        $group: {
          _id: {
            categoryId: '$categoryId',
            categoryTitle: '$categoryTitle',
          },
          totalSessions: { $sum: 1 },
          bestScore: { $max: '$score' },
          latestScore: { $first: '$score' },
          totalScoreAccumulated: { $sum: '$score' },
          latestPlayedAt: { $max: '$createdAt' },
        },
      },
      {
        $project: {
          _id: 0,
          categoryId: { $toString: '$_id.categoryId' },
          categoryTitle: '$_id.categoryTitle',
          totalSessions: 1,
          bestScore: 1,
          latestScore: 1,
          totalScoreAccumulated: 1,
          latestPlayedAt: 1,
        },
      },
      { $sort: { latestPlayedAt: -1 } },
    ]);

    return res.json({ summary });
  }),
);

router.get(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 8), 1), 30);

    const scores = await Score.find({ userId: req.authUser.id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ scores: scores.map(serializeScore) });
  }),
);

router.post(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    if (req.body && typeof req.body.userId !== 'undefined') {
      return res.status(400).json({
        message: 'Không được truyền userId. Server tự gắn score theo user đang đăng nhập.',
      });
    }

    const categoryId = String(req.body?.categoryId || '');
    const score = Number(req.body?.score);
    const attempts = Number(req.body?.attempts);
    const durationSeconds = Number(req.body?.durationSeconds);
    const totalPairs = Number(req.body?.totalPairs);
    const correctPairs = Number(req.body?.correctPairs);
    const mode = req.body?.mode === 'wrong-only' ? 'wrong-only' : 'all';

    if (!mongoose.isValidObjectId(categoryId)) {
      return res.status(400).json({ message: 'categoryId không hợp lệ.' });
    }

    if (!Number.isFinite(score)) {
      return res
        .status(400)
        .json({ message: 'score không hợp lệ.' });
    }

    const nonNegativeFields = [
      ['attempts', attempts],
      ['durationSeconds', durationSeconds],
      ['totalPairs', totalPairs],
      ['correctPairs', correctPairs],
    ];

    const invalid = nonNegativeFields.find(
      ([, value]) => !Number.isFinite(value) || value < 0,
    );
    if (invalid) {
      return res.status(400).json({ message: `${String(invalid[0])} không hợp lệ.` });
    }

    const category = await Category.findById(categoryId).lean();
    if (!category) {
      return res.status(404).json({ message: 'Không tìm thấy chủ đề.' });
    }

    const created = await Score.create({
      userId: req.authUser.id,
      categoryId,
      categoryTitle: category.title,
      score: Math.round(score),
      attempts: Math.round(attempts),
      durationSeconds: Math.round(durationSeconds),
      totalPairs: Math.round(totalPairs),
      correctPairs: Math.round(correctPairs),
      mode,
    });

    return res.status(201).json({ score: serializeScore(created) });
  }),
);

export { router as scoreRoutes };
