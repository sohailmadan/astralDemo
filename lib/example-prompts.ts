/**
 * The brief's Page 1 spec lists these as example prompts shown to the user.
 * Kept as one source of truth so the UI chips and (later) evals/generation.eval.yaml
 * reference the same list rather than drifting apart.
 */
export const EXAMPLE_PROMPTS = [
  "Teach me about y-intercept and slope.",
  "Teach me how long division works.",
  "Help me understand equivalent fractions.",
  "Teach me how angles work.",
  "Give me something interactive to practice counting numbers.",
] as const;
