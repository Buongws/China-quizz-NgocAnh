import express from 'express';
import mongoose from 'mongoose';
import { authRequired } from '../middleware/authRequired.js';
import { adminRequired } from '../middleware/adminRequired.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { User } from '../models/User.js';
import { Score } from '../models/Score.js';
import { Category } from '../models/Category.js';
import { Question } from '../models/Question.js';
import {
  serializeCategory,
  serializeQuestion,
  serializeScore,
  serializeUser,
} from '../utils/serialize.js';

const router = express.Router();

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function slugifyCategoryTitle(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

  return slug || `category-${Date.now().toString(36)}`;
}

async function buildUniqueCategorySlug(baseSlug) {
  let slug = baseSlug;
  let counter = 2;

  while (await Category.exists({ slug })) {
    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }

  return slug;
}

async function buildUniqueQuestionLegacyId(categoryId, requestedLegacyId) {
  const seed =
    String(requestedLegacyId || '').trim() ||
    `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  let legacyId = seed;
  let counter = 2;

  while (await Question.exists({ categoryId, legacyId })) {
    legacyId = `${seed}-${counter}`;
    counter += 1;
  }

  return legacyId;
}

function buildStudentScoreSummary(scores) {
  if (!scores || scores.length === 0) {
    return {
      totalSessions: 0,
      totalScoreAccumulated: 0,
      bestScore: 0,
      latestScore: null,
      lastPlayedAt: null,
    };
  }

  let totalScoreAccumulated = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const score of scores) {
    totalScoreAccumulated += Number(score.score) || 0;
    bestScore = Math.max(bestScore, Number(score.score) || 0);
  }

  return {
    totalSessions: scores.length,
    totalScoreAccumulated,
    bestScore: Number.isFinite(bestScore) ? bestScore : 0,
    latestScore: scores[0]?.score ?? null,
    lastPlayedAt: scores[0]?.createdAt ?? null,
  };
}

router.get(
  '/',
  authRequired,
  adminRequired,
  asyncHandler(async (req, res) => {
    const limitStudents = clampNumber(req.query.limitStudents, 1, 200, 50);
    const recentScoreLimit = clampNumber(req.query.recentScoreLimit, 1, 20, 5);
    const userIdFilter = req.query.userId ? String(req.query.userId) : null;

    if (userIdFilter && !mongoose.isValidObjectId(userIdFilter)) {
      return res.status(400).json({ message: 'userId không hợp lệ.' });
    }

    const userQuery = userIdFilter
      ? { _id: userIdFilter, role: { $ne: 'admin' } }
      : { role: { $ne: 'admin' } };

    const students = await User.find(userQuery)
      .sort({ createdAt: -1 })
      .limit(limitStudents)
      .lean();

    const studentIds = students.map((user) => user._id);

    const allScores = studentIds.length
      ? await Score.find({ userId: { $in: studentIds } })
          .sort({ createdAt: -1 })
          .lean()
      : [];

    const scoresByUserId = new Map();
    for (const score of allScores) {
      const userId = String(score.userId);
      const list = scoresByUserId.get(userId) || [];
      list.push(score);
      scoresByUserId.set(userId, list);
    }

    const studentRows = students.map((student) => {
      const userId = String(student._id);
      const scores = scoresByUserId.get(userId) || [];
      const stats = buildStudentScoreSummary(scores);

      return {
        student: serializeUser(student),
        stats,
        recentScores: scores.slice(0, recentScoreLimit).map(serializeScore),
      };
    });

    const [totalStudents, totalScoreRecords, totalCategories] = await Promise.all([
      User.countDocuments({ role: { $ne: 'admin' } }),
      Score.countDocuments(),
      Category.countDocuments({ isActive: true }),
    ]);

    return res.json({
      summary: {
        totalStudents,
        totalScoreRecords,
        totalCategories,
        returnedStudents: studentRows.length,
      },
      students: studentRows,
    });
  }),
);

router.post(
  '/categories',
  authRequired,
  adminRequired,
  asyncHandler(async (req, res) => {
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const requestedSlug = String(req.body?.slug || '').trim().toLowerCase();

    if (!title) {
      return res.status(400).json({ message: 'Tên bộ từ là bắt buộc.' });
    }

    if (title.length > 80) {
      return res.status(400).json({ message: 'Tên bộ từ tối đa 80 ký tự.' });
    }

    const normalizedSlug = requestedSlug || slugifyCategoryTitle(title);
    if (!normalizedSlug) {
      return res.status(400).json({ message: 'Slug không hợp lệ.' });
    }

    if (!/^[a-z0-9-]{2,64}$/.test(normalizedSlug)) {
      return res.status(400).json({
        message: 'Slug chỉ gồm chữ thường, số và dấu gạch ngang (2-64 ký tự).',
      });
    }

    const uniqueSlug = await buildUniqueCategorySlug(normalizedSlug);

    const lastCategory = await Category.findOne()
      .sort({ order: -1, createdAt: -1 })
      .lean();

    const created = await Category.create({
      slug: uniqueSlug,
      title,
      description,
      order: Number(lastCategory?.order || 0) + 1,
      isActive: true,
    });

    return res.status(201).json({
      category: serializeCategory(created, 0),
    });
  }),
);

router.post(
  '/questions',
  authRequired,
  adminRequired,
  asyncHandler(async (req, res) => {
    const categoryId = String(req.body?.categoryId || '').trim();
    const question = String(req.body?.question || '').trim();
    const answer = String(req.body?.answer || '').trim();
    const requestedLegacyId = String(req.body?.legacyId || '').trim();

    if (!mongoose.isValidObjectId(categoryId)) {
      return res.status(400).json({ message: 'categoryId không hợp lệ.' });
    }

    if (!question) {
      return res.status(400).json({ message: 'Nghĩa tiếng Việt là bắt buộc.' });
    }

    if (!answer) {
      return res.status(400).json({ message: 'Chữ Hán là bắt buộc.' });
    }

    if (question.length > 120) {
      return res.status(400).json({ message: 'Nghĩa tiếng Việt tối đa 120 ký tự.' });
    }

    if (answer.length > 120) {
      return res.status(400).json({ message: 'Chữ Hán tối đa 120 ký tự.' });
    }

    const category = await Category.findById(categoryId).lean();
    if (!category) {
      return res.status(404).json({ message: 'Không tìm thấy bộ từ.' });
    }

    const lastQuestion = await Question.findOne({ categoryId })
      .sort({ order: -1, createdAt: -1 })
      .lean();

    const legacyId = await buildUniqueQuestionLegacyId(categoryId, requestedLegacyId);

    const created = await Question.create({
      categoryId,
      legacyId,
      question,
      answer,
      order: Number(lastQuestion?.order || 0) + 1,
      isActive: true,
    });

    return res.status(201).json({
      question: serializeQuestion(created),
    });
  }),
);

router.get(
  '/students/:userId/scores',
  authRequired,
  adminRequired,
  asyncHandler(async (req, res) => {
    const userId = String(req.params.userId || '');
    const limit = clampNumber(req.query.limit, 1, 200, 50);

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ message: 'userId không hợp lệ.' });
    }

    const student = await User.findById(userId).lean();
    if (!student || student.role === 'admin') {
      return res.status(404).json({ message: 'Không tìm thấy học sinh.' });
    }

    const scores = await Score.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      student: serializeUser(student),
      stats: buildStudentScoreSummary(scores),
      scores: scores.map(serializeScore),
    });
  }),
);

export { router as adminDashboardRoutes };
