/**
 * Which lessons carry questions (a quiz). Quiz, assessment and audio lessons always do. A video lesson may: it counts as a
 * quiz lesson only when it has questions, so a video without questions behaves exactly as it always has (completed by
 * watching, or by marking it watched when it is a link whose playback cannot be measured).
 */
export const ALWAYS_QUESTION_TYPES = ["QUIZ", "ASSESSMENT", "AUDIO"] as const;

/** Lesson types that may hold questions at all. */
export const QUESTION_CAPABLE_TYPES = ["QUIZ", "ASSESSMENT", "AUDIO", "VIDEO"] as const;

export function canHoldQuestions(contentType: string): boolean {
  return (QUESTION_CAPABLE_TYPES as readonly string[]).includes(contentType);
}

/** Is this lesson a quiz lesson right now? `questionCount` is how many questions it has. */
export function isQuizLesson(contentType: string, questionCount: number): boolean {
  return (ALWAYS_QUESTION_TYPES as readonly string[]).includes(contentType) || (contentType === "VIDEO" && questionCount > 0);
}
