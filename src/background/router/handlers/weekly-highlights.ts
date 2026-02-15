import { db } from '../../storage/db';
import { GetWeeklyHighlightsPayload, GetWeeklyHighlightsResult } from '../../types/protocol';

export async function handleGetWeeklyHighlights(payload: unknown): Promise<GetWeeklyHighlightsResult> {
  const { limit = 50 } = (payload as GetWeeklyHighlightsPayload) || {};
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const rows = await db.lemmaStats
    .where('lastSeenAt')
    .aboveOrEqual(weekAgo)
    .toArray();

  // Include all words seen this week (including promoted/mastered)
  const candidates = rows
    .filter(r => r.totalCount >= 2)
    .sort((a, b) => {
      if (a.inWordbank !== b.inWordbank) return a.inWordbank ? 1 : -1;
      if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
      return (b.dictRank ?? 0) - (a.dictRank ?? 0);
    })
    .slice(0, Math.max(1, limit));

  // Batch lookup vocab for promoted words
  const promotedIds = candidates
    .map(c => c.promotedVocabId)
    .filter((id): id is string => !!id);
  const vocabMap = new Map<string, { vocabId: string; isKnown?: boolean }>();
  if (promotedIds.length) {
    const vocabs = await db.vocabulary.where('vocabId').anyOf(promotedIds).toArray();
    for (const v of vocabs) {
      vocabMap.set(v.vocabId, { vocabId: v.vocabId, isKnown: v.isKnown });
    }
  }

  return {
    items: candidates.map(c => {
      const vocab = c.promotedVocabId ? vocabMap.get(c.promotedVocabId) : undefined;
      return {
        lemma: c.lemma,
        vocabId: vocab?.vocabId,
        source: c.inWordbank ? 'wordbank' as const : 'environment' as const,
        totalCount: c.totalCount,
        rank: c.dictRank,
        mastered: vocab?.isKnown === true,
      };
    }),
  };
}
