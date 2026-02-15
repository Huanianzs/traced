import { db } from '../../storage/db';
import { calculateWeightedScore } from '../../../lib/domain-utils';
import {
  GetGiantWordbankPayload,
  GetGiantWordbankResult,
  DrawTimelineCardPayload,
  DrawTimelineCardResult,
  TimelineCard,
} from '../../types/protocol';
import { KNOWN_THRESHOLD } from './vocab';

export async function handleGetGiantWordbank(payload: unknown): Promise<GetGiantWordbankResult> {
  const raw = (payload as GetGiantWordbankPayload) || {};
  const limit = Math.max(1, Math.min(200, Math.floor(raw.limit ?? 50)));
  const offset = Math.max(0, Math.floor(raw.offset ?? 0));
  const sortBy = raw.sortBy ?? 'frequency';
  const sortOrder = raw.sortOrder ?? 'desc';
  const filter = raw.filter ?? 'all';
  const search = raw.search;

  let rows = await db.lemmaStats.toArray();

  // Join with vocabulary for traced/known status
  const promotedIds = rows.map(r => r.promotedVocabId).filter((id): id is string => !!id);
  const vocabMap = new Map<string, { vocabId: string; isTraced?: boolean; isKnown?: boolean; familiarityScore?: number }>();
  if (promotedIds.length) {
    const vocabs = await db.vocabulary.where('vocabId').anyOf(promotedIds).toArray();
    for (const v of vocabs) {
      vocabMap.set(v.vocabId, { vocabId: v.vocabId, isTraced: v.isTraced, isKnown: v.isKnown, familiarityScore: v.familiarityScore });
    }
  }

  // Apply filter
  if (filter === 'traced') {
    rows = rows.filter(r => r.promotedVocabId && vocabMap.get(r.promotedVocabId)?.isTraced);
  } else if (filter === 'known') {
    rows = rows.filter(r => r.promotedVocabId && vocabMap.get(r.promotedVocabId)?.isKnown);
  } else if (filter === 'learning') {
    rows = rows.filter(r => {
      if (!r.promotedVocabId) return false;
      const v = vocabMap.get(r.promotedVocabId);
      return v && !v.isKnown && (v.familiarityScore ?? 0) > 0;
    });
  }

  // Apply search
  if (search?.trim()) {
    const q = search.toLowerCase();
    rows = rows.filter(r => r.lemma.includes(q) || r.normalizedLemma.includes(q));
  }

  const total = rows.length;

  // Sort
  rows.sort((a, b) => {
    const cmp = sortBy === 'recency'
      ? a.lastSeenAt - b.lastSeenAt
      : a.totalCount - b.totalCount;
    return sortOrder === 'desc' ? -cmp : cmp;
  });

  const page = rows.slice(offset, offset + limit);

  return {
    items: page.map(r => {
      const v = r.promotedVocabId ? vocabMap.get(r.promotedVocabId) : undefined;
      return {
        lemmaStatId: r.lemmaStatId,
        lemma: r.lemma,
        normalizedLemma: r.normalizedLemma,
        totalCount: r.totalCount,
        pageCount: r.pageCount,
        firstSeenAt: r.firstSeenAt,
        lastSeenAt: r.lastSeenAt,
        inWordbank: r.inWordbank,
        dictRank: r.dictRank,
        vocabId: v?.vocabId,
        isTraced: v?.isTraced,
        isKnown: v?.isKnown,
        familiarityScore: v?.familiarityScore,
      };
    }),
    total,
  };
}

export async function handleDrawTimelineCard(payload: unknown): Promise<DrawTimelineCardResult> {
  const rawPayload = (payload as DrawTimelineCardPayload) || {};
  const count = Math.max(1, Math.min(20, Math.floor(rawPayload.count ?? 5)));
  const excludeIds = rawPayload.excludeIds ?? [];
  const excludeSet = new Set(excludeIds);
  const tracedOnly = rawPayload.tracedOnly ?? false;

  // Get eligible vocab: not known, not locked, has encounters
  const candidates = await db.vocabulary
    .filter(v => !v.deletedAt && !v.scoreLocked && !v.isKnown && !excludeSet.has(v.vocabId) && (!tracedOnly || v.isTraced === true))
    .toArray();

  if (!candidates.length) return { cards: [] };

  // Batch fetch encounters
  const vocabIds = candidates.map(v => v.vocabId);
  const allEncounters = await db.encounters.where('vocabId').anyOf(vocabIds).toArray();
  const encountersByVocab = new Map<string, typeof allEncounters>();
  for (const e of allEncounters) {
    const arr = encountersByVocab.get(e.vocabId) || [];
    arr.push(e);
    encountersByVocab.set(e.vocabId, arr);
  }

  // Score and filter: prefer words with rich context (traced words don't require context)
  const scored = candidates
    .filter(v => {
      const encs = encountersByVocab.get(v.vocabId) || [];
      if (encs.length === 0) return false;
      return v.isTraced || encs.some(e => e.contextSentence);
    })
    .map(v => {
      const encs = encountersByVocab.get(v.vocabId) || [];
      const score = calculateWeightedScore(encs.map(e => ({ source: e.source })), v.isTraced ? 2 : 1);
      const contextCount = encs.filter(e => e.contextSentence).length;
      // Priority: traced words first, then by context richness
      const priority = (v.isTraced ? 100 : 0) + contextCount * 10 + (KNOWN_THRESHOLD - score);
      return { vocab: v, encs, score, priority };
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, count);

  const cards: TimelineCard[] = scored.map(({ vocab, encs, score }) => ({
    vocabId: vocab.vocabId,
    lemma: vocab.lemma,
    surface: vocab.surface,
    meaning: vocab.meaning || '',
    weightedScore: score,
    isTraced: vocab.isTraced ?? false,
    encounters: encs
      .sort((a, b) => {
        // trace & lookup first, then by recency
        const p = (s: string) => s === 'trace' ? 0 : s === 'lookup' ? 1 : 2;
        return p(a.source) - p(b.source) || b.createdAt - a.createdAt;
      })
      .slice(0, 8)
      .map(e => ({
        encounterId: e.encounterId,
        pageTitle: e.pageTitle,
        pageUrl: e.pageUrl,
        contextSentence: e.contextSentence,
        source: e.source,
        createdAt: e.createdAt,
      })),
  }));

  return { cards };
}
