export function normalizeLemma(input: string): string {
  return input.toLowerCase().trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

export const SCORING_WEIGHTS: Record<string, number> = {
  scan: 0.1,
  lookup: 1.0,
  trace: 1.0,
  manual: 2.0,
  import: 0.5,
  wordbank: 0.1,
  rate_known: 5.0,
  rate_familiar: 3.0,
  rate_unknown: 1.0
};

export function calculateWeightedScore(encounters: { source: string }[], multiplier: number = 1): number {
  return encounters.reduce((sum, e) => {
    const points = (SCORING_WEIGHTS[e.source] || 0.1) * multiplier;
    return Math.max(0, sum + points);
  }, 0);
}
