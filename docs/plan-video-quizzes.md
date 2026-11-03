# Questions and quizzes on video lessons

Requested 2026-11-03. Proposal only; nothing is built.

## Today
Only lessons of type QUIZ, ASSESSMENT and AUDIO can have questions. The list is repeated in about twelve places (course builder, lesson editor, learner view, quiz service, progress and completion maths, tracking, course card counts).
An audio lesson with questions works like this: the learner listens until the required percentage is reached, then the questions open (`audioGate` in `quiz.service.ts`), and passing the quiz can be required for completion.

## Risk to avoid
Simply adding VIDEO to those lists would make every existing video lesson count as a quiz lesson. Completion maths would then wait for a quiz pass on videos that have no questions, and the course overview would warn "no questions yet" on every video. So a video counts as a quiz lesson only when it has at least one question.

## Proposal
- A video lesson can have questions, built on the same lesson page and in the same question bank as audio.
- Same gate as audio: the questions open once the learner has watched the required percentage (already tracked for uploaded videos and for YouTube, Vimeo and Loom through the existing progress tracker).
- Completion and certification rules do not change: a video with questions counts toward "pass every required quiz" only once it has questions; videos without questions behave exactly as today.
- Course cards, learner progress and the staff tracking tables count video quizzes the same way as audio quizzes.
- No migration and no new permission.

## Decisions for you
1. A video quiz counts as a required quiz only when the lesson has questions (recommended), not for every video.
2. The questions open only after the required watch percentage, as for audio (recommended). The alternative is to let learners answer any time.
3. For a video that is only a link where progress cannot be tracked, the questions open immediately (nothing to measure). The alternative is to hide questions for such links.
