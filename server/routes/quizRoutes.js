import express from 'express';
import mongoose from 'mongoose';
import { authRequired } from '../middleware/authRequired.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { Question } from '../models/Question.js';
import { serializeQuestion } from '../utils/serialize.js';

const router = express.Router();

router.get(
  '/questions',
  authRequired,
  asyncHandler(async (req, res) => {
    const categoryId = String(req.query.categoryId || '');

    if (!mongoose.isValidObjectId(categoryId)) {
      return res.status(400).json({ message: 'categoryId không hợp lệ.' });
    }

    const questions = await Question.find({ categoryId, isActive: true })
      .sort({ order: 1, createdAt: 1 })
      .lean();

    return res.json({
      questions: questions.map(serializeQuestion),
    });
  }),
);

export { router as quizRoutes };
