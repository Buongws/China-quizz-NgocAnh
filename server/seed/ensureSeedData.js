import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Category } from '../models/Category.js';
import { Question } from '../models/Question.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const questionsJsonPath = path.resolve(__dirname, '../../src/data/questions.json');

async function loadLocalQuestions() {
  const raw = await fs.readFile(questionsJsonPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item, index) => ({
      id: String(item?.id ?? index + 1),
      question: String(item?.question ?? '').trim(),
      answer: String(item?.answer ?? '').trim(),
    }))
    .filter((item) => item.question.length > 0 && item.answer.length > 0);
}

function splitSeedData(items) {
  const weatherIds = new Set(['1', '2', '3', '6', '7', '9', '10']);
  const weather = [];
  const mixed = [];

  for (const item of items) {
    if (weatherIds.has(item.id)) weather.push(item);
    else mixed.push(item);
  }

  return [
    {
      slug: 'weather',
      title: 'Thời tiết',
      description: 'Từ vựng thời tiết và hiện tượng khí hậu.',
      order: 1,
      items: weather,
    },
    {
      slug: 'basic-mix',
      title: 'Mùa & Từ cơ bản',
      description: 'Mùa trong năm và từ vựng cơ bản.',
      order: 2,
      items: mixed,
    },
  ].filter((group) => group.items.length > 0);
}

export async function ensureSeedData() {
  const [categoryCount, questionCount] = await Promise.all([
    Category.countDocuments(),
    Question.countDocuments(),
  ]);

  if (categoryCount > 0 && questionCount > 0) {
    return;
  }

  const sourceQuestions = await loadLocalQuestions();
  const groups = splitSeedData(sourceQuestions);

  for (const group of groups) {
    const category = await Category.findOneAndUpdate(
      { slug: group.slug },
      {
        slug: group.slug,
        title: group.title,
        description: group.description,
        order: group.order,
        isActive: true,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await Promise.all(
      group.items.map((item, index) =>
        Question.findOneAndUpdate(
          { categoryId: category._id, legacyId: item.id },
          {
            categoryId: category._id,
            legacyId: item.id,
            question: item.question,
            answer: item.answer,
            order: index + 1,
            isActive: true,
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        ),
      ),
    );
  }
}
