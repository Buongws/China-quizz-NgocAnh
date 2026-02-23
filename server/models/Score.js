import mongoose from 'mongoose';

const scoreSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
      index: true,
    },
    categoryTitle: { type: String, required: true, trim: true },
    score: { type: Number, required: true },
    attempts: { type: Number, required: true, min: 0 },
    durationSeconds: { type: Number, required: true, min: 0 },
    totalPairs: { type: Number, required: true, min: 0 },
    correctPairs: { type: Number, required: true, min: 0 },
    mode: { type: String, enum: ['all', 'wrong-only'], default: 'all' },
  },
  { timestamps: true },
);

scoreSchema.index({ userId: 1, createdAt: -1 });
scoreSchema.index({ userId: 1, categoryId: 1, mode: 1, createdAt: -1 });

export const Score = mongoose.models.Score || mongoose.model('Score', scoreSchema);
