import express from 'express';
import { authRequired } from '../middleware/authRequired.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { Category } from '../models/Category.js';
import { Question } from '../models/Question.js';
import { serializeCategory } from '../utils/serialize.js';

const router = express.Router();

router.get(
  '/',
  authRequired,
  asyncHandler(async (_req, res) => {
    const categories = await Category.find({ isActive: true })
      .sort({ order: 1, createdAt: 1 })
      .lean();

    const countEntries = await Promise.all(
      categories.map(async (category) => [
        String(category._id),
        await Question.countDocuments({ categoryId: category._id, isActive: true }),
      ]),
    );

    const countMap = new Map(countEntries);

    return res.json({
      categories: categories.map((item) =>
        serializeCategory(item, countMap.get(String(item._id)) || 0),
      ),
    });
  }),
);

export { router as categoryRoutes };
