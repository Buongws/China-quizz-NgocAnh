export function serializeUser(userDoc) {
  return {
    id: String(userDoc._id),
    username: userDoc.username || '',
    email: userDoc.email || '',
    displayName: userDoc.displayName || '',
    role: userDoc.role || 'student',
    createdAt: userDoc.createdAt,
  };
}

export function serializeCategory(categoryDoc, questionCount = 0) {
  return {
    id: String(categoryDoc._id),
    slug: categoryDoc.slug,
    title: categoryDoc.title,
    description: categoryDoc.description || '',
    order: categoryDoc.order || 0,
    questionCount,
  };
}

export function serializeQuestion(questionDoc) {
  return {
    id: String(questionDoc._id),
    question: questionDoc.question,
    answer: questionDoc.answer,
    categoryId: String(questionDoc.categoryId),
    legacyId: questionDoc.legacyId,
    order: questionDoc.order || 0,
  };
}

export function serializeScore(scoreDoc) {
  return {
    id: String(scoreDoc._id),
    userId: String(scoreDoc.userId),
    categoryId: String(scoreDoc.categoryId),
    categoryTitle: scoreDoc.categoryTitle,
    score: scoreDoc.score,
    attempts: scoreDoc.attempts,
    durationSeconds: scoreDoc.durationSeconds,
    totalPairs: scoreDoc.totalPairs,
    correctPairs: scoreDoc.correctPairs,
    mode: scoreDoc.mode,
    createdAt: scoreDoc.createdAt,
  };
}
