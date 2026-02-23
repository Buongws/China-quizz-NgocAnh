import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema(
  {
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
      index: true,
    },
    legacyId: { type: String, required: true, trim: true },
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

questionSchema.index({ categoryId: 1, legacyId: 1 }, { unique: true });

export const Question =
  mongoose.models.Question || mongoose.model('Question', questionSchema);
