import { db, VocabEntity } from '../../storage/db';
import { normalizeLemma, calculateWeightedScore } from '../../../lib/domain-utils';
import { AppError } from '../../types/errors';
import { GetVocabListPayload, GetVocabListResult, UpsertVocabPayload, RateWordPayload, GetHighlightSelectionPayload, HighlightSelectionResult, ToggleTraceWordPayload, ToggleTraceWordResult, DrawCardPayload, DrawCardResult } from '../../types/protocol';

export async function handleUpsertVocab(payload: unknown): Promise<VocabEntity> {
  const data = payload as UpsertVocabPayload;
  const now = Date.now();

  if (!data?.lemma?.trim()) {
    throw new AppError('VALIDATION_ERROR', 'lemma is required', false);
  }

  const lemma = normalizeLemma(data.lemma);
  const language = data.language || 'en';

  if (data.vocabId) {
    const existing = await db.vocabulary.get(data.vocabId);
    if (existing) {
      const updated = { ...existing, ...data, lemma, updatedAt: now };
      await db.vocabulary.put(updated);
      return updated;
    }
  }

  const found = await db.vocabulary.where('[lemma+language]').equals([lemma, language]).first();
  if (found) {
    const updated = {
      ...found,
      surface: data.surface || found.surface,
      meaning: data.meaning ?? found.meaning,
      proficiency: data.proficiency ?? found.proficiency,
      updatedAt: now
    };
    await db.vocabulary.put(updated);
    return updated;
  }

  const vocab: VocabEntity = {
    vocabId: crypto.randomUUID(),
    lemma,
    surface: data.surface || data.lemma,
    language,
    meaning: data.meaning || '',
    sourceTraceId: data.sourceTraceId,
    proficiency: data.proficiency ?? 0,
    createdAt: now,
    updatedAt: now
  };
  await db.vocabulary.add(vocab);
  return vocab;
}

export async function handleGetVocabList(payload: unknown): Promise<GetVocabListResult> {
  const { limit = 50, offset = 0, search, includeDeleted = false, vocabFilter = 'all' } = (payload as GetVocabListPayload) || {};

  let all = await db.vocabulary.orderBy('updatedAt').reverse().toArray();
  if (!includeDeleted) {
    all = all.filter(v => !v.deletedAt);
  }

  if (vocabFilter === 'noise') {
    all = all.filter(v => v.scoreLocked === true);
  } else if (vocabFilter === 'normal') {
    all = all.filter(v => !v.scoreLocked);
  } else if (vocabFilter === 'traced') {
    all = all.filter(v => v.isTraced === true);
  }

  if (search?.trim()) {
    const q = search.toLowerCase();
    all = all.filter(v =>
      v.lemma.includes(q) || v.surface.toLowerCase().includes(q) || v.meaning.toLowerCase().includes(q)
    );
  }

  const total = all.length;
  const page = all.slice(offset, offset + limit);

  const vocabIds = page.map(v => v.vocabId);
  const encountersByVocab = new Map<string, { count: number; last?: number; score: number }>();

  if (vocabIds.length) {
    const encounters = await db.encounters.where('vocabId').anyOf(vocabIds).toArray();
    for (const e of encounters) {
      const c = encountersByVocab.get(e.vocabId) || { count: 0, score: 0 };
      c.count++;
      if (!c.last || e.createdAt > c.last) c.last = e.createdAt;
      encountersByVocab.set(e.vocabId, c);
    }

    // Calculate weighted scores using the shared function
    for (const vocabId of vocabIds) {
      const vocabEncounters = encounters.filter(e => e.vocabId === vocabId);
      const vocab = page.find(p => p.vocabId === vocabId);
      if (vocabEncounters.length > 0 && vocab) {
        const score = calculateWeightedScore(vocabEncounters, vocab.isTraced ? 2 : 1);
        const c = encountersByVocab.get(vocabId);
        if (c) c.score = score;
      }
    }
  }

  const COLD_THRESHOLD = 14 * 24 * 60 * 60 * 1000; // 14 days
  const now = Date.now();

  return {
    items: page.map(v => {
      const enc = encountersByVocab.get(v.vocabId);
      const lastEnc = enc?.last;
      return {
        ...v,
        encounterCount: enc?.count || 0,
        weightedScore: Math.max(0, enc?.score || 0),
        lastEncounterAt: lastEnc,
        isTraced: v.isTraced,
        isCold: v.isTraced && (!lastEnc || (now - lastEnc) > COLD_THRESHOLD),
      };
    }),
    total
  };
}

export { calculateWeightedScore, SCORING_WEIGHTS } from '../../../lib/domain-utils';

export const KNOWN_THRESHOLD = 100;

/**
 * Cleanup orphaned vocabulary (no remaining encounters)
 * Shared cleanup logic used after deleting encounters or traces
 */
export async function cleanupOrphanedVocab(vocabId: string): Promise<boolean> {
  const remainingCount = await db.encounters.where('vocabId').equals(vocabId).count();
  if (remainingCount === 0) {
    await db.vocabulary.delete(vocabId);
    return true;
  }
  return false;
}

export async function recalcVocabScore(vocabId: string): Promise<void> {
  const vocab = await db.vocabulary.get(vocabId);
  if (!vocab || vocab.deletedAt || vocab.scoreLocked) return;
  const allEnc = await db.encounters.where('vocabId').equals(vocabId).toArray();
  const score = calculateWeightedScore(allEnc, vocab.isTraced ? 2 : 1);
  await db.vocabulary.update(vocabId, { familiarityScore: score, isKnown: score >= KNOWN_THRESHOLD, updatedAt: Date.now() });
}

/**
 * Get count of active traced words (not yet mastered)
 */
async function getActiveTraceCount(): Promise<number> {
  const traced = await db.vocabulary
    .filter(v => v.isTraced === true && !v.isKnown)
    .toArray();
  if (traced.length === 0) return 0;

  const ids = traced.map(v => v.vocabId);
  const allEnc = await db.encounters.where('vocabId').anyOf(ids).toArray();
  const encByVocab = new Map<string, { source: string }[]>();
  for (const e of allEnc) {
    const arr = encByVocab.get(e.vocabId) || [];
    arr.push({ source: e.source });
    encByVocab.set(e.vocabId, arr);
  }

  return traced.filter(v => {
    const score = calculateWeightedScore(encByVocab.get(v.vocabId) || [], 2);
    return score < KNOWN_THRESHOLD;
  }).length;
}

/**
 * Reset noise word fields after unlock
 * Shared logic for manual and auto unlock
 */
export async function resetNoiseWordFields(vocabId: string): Promise<void> {
  await db.vocabulary.update(vocabId, {
    scoreLocked: false,
    familiarityScore: 0,
    isKnown: false,
    noiseManaged: false,
    updatedAt: Date.now()
  });
}

export async function handleCheckVocab(payload: unknown): Promise<{ exists: boolean; vocab?: VocabEntity; hasEncounterOnPage?: boolean; encounterId?: string; traceId?: string; encounterCount?: number; weightedScore?: number }> {
  const { word, language = 'en', pageUrl } = payload as { word?: string; language?: string; pageUrl?: string };
  if (!word?.trim()) return { exists: false };

  const lemma = normalizeLemma(word);
  const found = await db.vocabulary.where('[lemma+language]').equals([lemma, language]).first();
  if (found && !found.deletedAt) {
    let hasEncounterOnPage = false;
    let encounterId: string | undefined;
    let traceId: string | undefined;
    const trace = await db.traces.filter(t => normalizeLemma(t.sourceText) === lemma && t.pageUrl === pageUrl).first();
    if (trace) {
      hasEncounterOnPage = true;
      traceId = trace.traceId;
      const traceEnc = await db.encounters.where('vocabId').equals(found.vocabId)
        .filter(e => e.source === 'trace').first();
      encounterId = traceEnc?.encounterId;
    }
    const allEncounters = await db.encounters.where('vocabId').equals(found.vocabId).toArray();
    const encounterCount = allEncounters.length;
    const weightedScore = calculateWeightedScore(allEncounters, found.isTraced ? 2 : 1);
    return { exists: true, vocab: found, hasEncounterOnPage, encounterId, traceId, encounterCount, weightedScore };
  }
  return { exists: false };
}

export async function handleDeleteVocab(payload: unknown): Promise<{ success: true; deletedVocabId: string }> {
  const { vocabId, hardDelete } = payload as { vocabId?: string; hardDelete?: boolean };

  if (!vocabId) {
    throw new AppError('VALIDATION_ERROR', 'vocabId is required', false);
  }

  const existing = await db.vocabulary.get(vocabId);
  if (!existing) {
    throw new AppError('NOT_FOUND', 'vocabulary not found', false);
  }

  if (hardDelete) {
    await db.transaction('rw', db.vocabulary, db.encounters, async () => {
      await db.vocabulary.delete(vocabId);
      await db.encounters.where('vocabId').equals(vocabId).delete();
    });
  } else {
    await db.vocabulary.update(vocabId, { deletedAt: Date.now(), updatedAt: Date.now() });
  }

  return { success: true, deletedVocabId: vocabId };
}

export async function handleMarkMastered(payload: unknown): Promise<{ success: true; vocabId: string }> {
  const { vocabId } = payload as { vocabId?: string };

  if (!vocabId) {
    throw new AppError('VALIDATION_ERROR', 'vocabId is required', false);
  }

  const existing = await db.vocabulary.get(vocabId);
  if (!existing) {
    throw new AppError('NOT_FOUND', 'vocabulary not found', false);
  }

  await db.vocabulary.update(vocabId, { proficiency: 5, updatedAt: Date.now() });
  return { success: true, vocabId };
}

// Rate word familiarity (green/orange/red dot)
export async function handleRateWord(payload: unknown): Promise<{ success: true; vocabId: string; newScore: number; isKnown: boolean }> {
  const { vocabId, rating } = payload as RateWordPayload;

  if (!vocabId) {
    throw new AppError('VALIDATION_ERROR', 'vocabId is required', false);
  }

  const vocab = await db.vocabulary.get(vocabId);
  if (!vocab) {
    throw new AppError('NOT_FOUND', 'vocabulary not found', false);
  }
  if (vocab.scoreLocked) {
    throw new AppError('VALIDATION_ERROR', 'cannot rate a score-locked word', false);
  }

  const now = Date.now();
  const source = `rate_${rating}` as 'rate_known' | 'rate_familiar' | 'rate_unknown';

  await db.encounters.add({
    encounterId: crypto.randomUUID(),
    vocabId,
    surface: vocab.surface,
    normalizedSurface: vocab.lemma,
    pageUrl: '',
    pageHost: '',
    source,
    createdAt: now,
    updatedAt: now
  });

  const allEncounters = await db.encounters.where('vocabId').equals(vocabId).toArray();
  const newScore = calculateWeightedScore(allEncounters, vocab.isTraced ? 2 : 1);
  const isKnown = newScore >= KNOWN_THRESHOLD;

  await db.vocabulary.update(vocabId, {
    familiarityScore: newScore,
    isKnown,
    updatedAt: now
  });

  return { success: true, vocabId, newScore, isKnown };
}

export async function handleGetHighlightSelection(payload: unknown): Promise<HighlightSelectionResult> {
  const data = payload as GetHighlightSelectionPayload;
  const { matches } = data;

  if (!matches?.length) {
    return { highlighted: [], sidebar: [] };
  }

  return { highlighted: matches.filter(v => !v.isKnown), sidebar: [] };
}

export async function handleUnlockNoiseWord(payload: unknown): Promise<{ success: true; vocabId: string }> {
  const { vocabId } = payload as { vocabId: string };
  if (!vocabId) {
    throw new AppError('VALIDATION_ERROR', 'vocabId is required', false);
  }
  const vocab = await db.vocabulary.get(vocabId);
  if (!vocab) {
    throw new AppError('NOT_FOUND', 'vocabulary not found', false);
  }
  if (!vocab.scoreLocked) {
    throw new AppError('VALIDATION_ERROR', 'word is not locked', false);
  }
  await resetNoiseWordFields(vocabId);
  return { success: true, vocabId };
}

export async function handleToggleTraceWord(payload: unknown): Promise<ToggleTraceWordResult> {
  const { vocabId, traced } = payload as ToggleTraceWordPayload;
  if (!vocabId) {
    throw new AppError('VALIDATION_ERROR', 'vocabId is required', false);
  }
  const vocab = await db.vocabulary.get(vocabId);
  if (!vocab) {
    throw new AppError('NOT_FOUND', 'vocabulary not found', false);
  }

  // Skip if already in desired state
  if (vocab.isTraced === traced) {
    const activeTraceCount = await getActiveTraceCount();
    return { success: true, vocabId, isTraced: traced, activeTraceCount };
  }

  // Recalculate familiarityScore with new multiplier
  const allEncounters = await db.encounters.where('vocabId').equals(vocabId).toArray();
  const newMultiplier = traced ? 2 : 1;
  const newScore = calculateWeightedScore(allEncounters, newMultiplier);
  const isKnown = newScore >= KNOWN_THRESHOLD;

  await db.vocabulary.update(vocabId, {
    isTraced: traced,
    familiarityScore: newScore,
    isKnown,
    updatedAt: Date.now()
  });

  const activeTraceCount = await getActiveTraceCount();

  return { success: true, vocabId, isTraced: traced, activeTraceCount };
}

// Phase 5: Card drawing with SRS priority
export async function handleDrawCard(payload: unknown): Promise<DrawCardResult> {
  const { count = 10, mode = 'shuffle', excludeIds = [], seed } = (payload as DrawCardPayload) || {};
  const now = Date.now();
  const excludeSet = new Set(excludeIds);

  // Get eligible vocab: not known, not locked
  const candidates = await db.vocabulary
    .filter(v => !v.deletedAt && !v.scoreLocked && !v.isKnown)
    .toArray();

  if (candidates.length === 0) return { cards: [] };

  // Batch compute real-time scores from encounters
  const vocabIds = candidates.map(v => v.vocabId);
  const allEncounters = await db.encounters.where('vocabId').anyOf(vocabIds).toArray();
  const encountersByVocab = new Map<string, { source: string }[]>();
  for (const e of allEncounters) {
    const arr = encountersByVocab.get(e.vocabId) || [];
    arr.push({ source: e.source });
    encountersByVocab.set(e.vocabId, arr);
  }
  const scoreMap = new Map<string, number>();
  for (const v of candidates) {
    const encs = encountersByVocab.get(v.vocabId) || [];
    scoreMap.set(v.vocabId, calculateWeightedScore(encs, v.isTraced ? 2 : 1));
  }

  // Filter by real-time score < 100
  const eligible = candidates.filter(v =>
    !excludeSet.has(v.vocabId) && (scoreMap.get(v.vocabId) ?? 0) < KNOWN_THRESHOLD
  );
  if (eligible.length === 0) return { cards: [] };

  // Calculate priority scores
  const scored = eligible.map(v => {
    const score = scoreMap.get(v.vocabId) ?? 0;
    const lastSeen = v.lastSeenAt ?? v.createdAt ?? now;
    const daysSinceLastSeen = (now - lastSeen) / (24 * 60 * 60 * 1000);

    // SRS due factor (45%): higher if overdue for review, new words get 0.5 base
    const nextReview = v.nextReviewDate ?? 0;
    const srsDue = nextReview > 0 && nextReview < now
      ? Math.min(1, (now - nextReview) / (7 * 24 * 60 * 60 * 1000))
      : (nextReview === 0 ? 0.5 : 0);

    // Difficulty factor (25%): lower score = harder = higher priority
    const difficulty = 1 - score / KNOWN_THRESHOLD;

    // Urgency factor (20%): traced words get priority
    const urgency = v.isTraced ? 1 : 0.3;

    // Recency factor (10%): cold words (not seen recently) get slight boost
    const recency = Math.min(1, daysSinceLastSeen / 14);

    const priority = srsDue * 0.45 + difficulty * 0.25 + urgency * 0.20 + recency * 0.10;

    return { vocab: v, score, priority };
  });

  // Select cards based on mode
  const selected = mode === 'auto'
    ? pickTopN(scored, count)
    : weightedSampleWithoutReplacement(scored, count, seed);

  // Build encounter context map (latest contextSentence + pageTitle per vocab)
  const contextMap = new Map<string, { contextSentence?: string; pageTitle?: string }>();
  for (const e of allEncounters) {
    const existing = contextMap.get(e.vocabId);
    if (!existing || e.createdAt > (existing as unknown as { _ts?: number })._ts!) {
      if (e.contextSentence || e.pageTitle) {
        const entry = { contextSentence: e.contextSentence, pageTitle: e.pageTitle, _ts: e.createdAt } as { contextSentence?: string; pageTitle?: string; _ts: number };
        contextMap.set(e.vocabId, entry);
      }
    }
  }

  return {
    cards: selected.map(s => {
      const ctx = contextMap.get(s.vocab.vocabId);
      return {
        vocabId: s.vocab.vocabId,
        lemma: s.vocab.lemma,
        surface: s.vocab.surface,
        meaning: s.vocab.meaning || '',
        weightedScore: s.score,
        isTraced: s.vocab.isTraced ?? false,
        priority: Math.round(s.priority * 100) / 100,
        contextSentence: ctx?.contextSentence,
        pageTitle: ctx?.pageTitle,
      };
    })
  };
}

function pickTopN(items: Array<{ vocab: VocabEntity; score: number; priority: number }>, n: number) {
  return items.sort((a, b) => b.priority - a.priority).slice(0, n);
}

function weightedSampleWithoutReplacement(
  items: Array<{ vocab: VocabEntity; score: number; priority: number }>,
  n: number,
  seed?: number
): Array<{ vocab: VocabEntity; score: number; priority: number }> {
  // Seeded random number generator (simple LCG)
  const rng = seed !== undefined
    ? (() => {
        let state = seed;
        return () => {
          state = (state * 1664525 + 1013904223) % 4294967296;
          return state / 4294967296;
        };
      })()
    : Math.random;

  // Efraimidis-Spirakis algorithm
  const keyed = items.map(item => ({
    ...item,
    key: Math.pow(rng(), 1 / Math.max(0.001, item.priority))
  }));

  // Sort by key descending, take top n
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, n);
}

export interface TracedWordItem {
  vocabId: string;
  lemma: string;
  surface: string;
  weightedScore: number;
  meaning: string;
  sourceTraceId?: string;
  pageHost?: string;
  createdAt: number;
}

const VALID_WORD_RE = /^[a-z]{2,}$/;

export async function handleGetTracedWords(): Promise<{ words: TracedWordItem[] }> {
  const traced = await db.vocabulary
    .filter(v => v.isTraced === true && !v.isKnown && !v.deletedAt && VALID_WORD_RE.test(v.lemma))
    .toArray();
  if (!traced.length) return { words: [] };

  const ids = traced.map(v => v.vocabId);
  const allEnc = await db.encounters.where('vocabId').anyOf(ids).toArray();
  const encByVocab = new Map<string, { source: string }[]>();
  for (const e of allEnc) {
    const arr = encByVocab.get(e.vocabId) || [];
    arr.push({ source: e.source });
    encByVocab.set(e.vocabId, arr);
  }

  // Batch fetch trace translations
  const traceIds = traced.map(v => v.sourceTraceId).filter((id): id is string => !!id);
  const traceMap = new Map<string, { translatedText: string; pageHost: string }>();
  if (traceIds.length) {
    const traces = await db.traces.where('traceId').anyOf(traceIds).toArray();
    for (const t of traces) traceMap.set(t.traceId, { translatedText: t.translatedText, pageHost: t.pageHost });
  }

  const words: TracedWordItem[] = traced
    .map((v): TracedWordItem | null => {
      const score = calculateWeightedScore(encByVocab.get(v.vocabId) || [], 2);
      if (score >= KNOWN_THRESHOLD) return null;
      const trace = v.sourceTraceId ? traceMap.get(v.sourceTraceId) : undefined;
      return {
        vocabId: v.vocabId,
        lemma: v.lemma,
        surface: v.surface || v.lemma,
        weightedScore: score,
        meaning: trace?.translatedText || v.meaning || '',
        sourceTraceId: v.sourceTraceId,
        pageHost: trace?.pageHost,
        createdAt: v.createdAt ?? 0,
      };
    })
    .filter((w): w is TracedWordItem => w !== null)
    .sort((a, b) => b.createdAt - a.createdAt);

  return { words };
}
