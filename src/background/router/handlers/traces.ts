import { db, TraceEntity, createFingerprint } from '../../storage/db';
import { normalizeLemma, calculateWeightedScore } from '../../../lib/domain-utils';
import { recalcVocabScore } from './vocab';
import { handleTranslateSelection } from './translate-selection';
import { AppError } from '../../types/errors';
import { SaveTracePayload, GetTracesPayload, DeleteTracePayload } from '../../types/protocol';

export async function handleDeleteTrace(payload: unknown): Promise<{ success: boolean }> {
  const { traceId } = payload as DeleteTracePayload;
  if (!traceId) {
    throw new AppError('VALIDATION_ERROR', 'traceId is required', false);
  }

  const trace = await db.traces.get(traceId);
  await db.traces.delete(traceId);

  if (trace) {
    const lemma = normalizeLemma(trace.sourceText);
    const vocab = await db.vocabulary.where('[lemma+language]').equals([lemma, 'en']).first();
    if (vocab) {
      // Check if any other traces remain for this word
      const otherTrace = await db.traces.filter(t => normalizeLemma(t.sourceText) === lemma).first();
      if (!otherTrace && vocab.isTraced) {
        await db.vocabulary.update(vocab.vocabId, { isTraced: false, updatedAt: Date.now() });
      }
      await recalcVocabScore(vocab.vocabId);
    }
  }

  return { success: true };
}

export async function handleSaveTrace(payload: unknown): Promise<TraceEntity> {
  const data = payload as SaveTracePayload;

  if (!data.sourceText?.trim()) {
    throw new AppError('VALIDATION_ERROR', 'sourceText is required', false);
  }

  const now = Date.now();
  const pageHost = new URL(data.pageUrl).host;
  const fingerprint = createFingerprint(data.sourceText, data.pageUrl);

  let trace: TraceEntity;
  const existing = await db.traces.where('fingerprint').equals(fingerprint).first();
  if (existing) {
    const translatedText = data.translatedText || existing.translatedText;
    await db.traces.update(existing.traceId, { updatedAt: now, translatedText, contextSentence: data.contextSentence });
    trace = { ...existing, updatedAt: now, translatedText, contextSentence: data.contextSentence };
  } else {
    trace = {
      traceId: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      sourceText: data.sourceText.trim(),
      contextSentence: data.contextSentence,
      translatedText: data.translatedText,
      styleMode: data.styleMode,
      pageUrl: data.pageUrl,
      pageHost,
      pageTitle: data.pageTitle,
      faviconUrl: data.faviconUrl,
      locator: data.locator,
      fingerprint,
    };
    await db.traces.add(trace);
  }

  // Mark vocab as traced
  const traceLemma = normalizeLemma(trace.sourceText);
  const traceVocab = await db.vocabulary.where('[lemma+language]').equals([traceLemma, 'en']).first();
  if (traceVocab) {
    const updates: Record<string, unknown> = { sourceTraceId: trace.traceId, updatedAt: Date.now() };
    if (!traceVocab.isTraced) updates.isTraced = true;
    await db.vocabulary.update(traceVocab.vocabId, updates);
    if (!traceVocab.isTraced) await recalcVocabScore(traceVocab.vocabId);
  }

  if (!trace.translatedText?.trim()) {
    try {
      const result = await handleTranslateSelection({ sourceText: trace.sourceText, mode: trace.styleMode });
      trace.translatedText = result.translatedText;
      await db.traces.update(trace.traceId, { translatedText: result.translatedText, updatedAt: Date.now() });
    } catch (err) {
      console.error('Auto-translate failed:', err);
    }
  }

  return trace;
}

type TraceWithScore = TraceEntity & { weightedScore?: number };

async function enrichWithScores(traces: TraceEntity[]): Promise<TraceWithScore[]> {
  if (!traces.length) return [];
  const lemmas = [...new Set(traces.map(t => normalizeLemma(t.sourceText)))];
  const vocabMap = new Map<string, { vocabId: string; isTraced?: boolean }>();
  for (const lemma of lemmas) {
    const v = await db.vocabulary.where('[lemma+language]').equals([lemma, 'en']).first();
    if (v) vocabMap.set(lemma, { vocabId: v.vocabId, isTraced: v.isTraced });
  }
  const vocabIds = [...new Set([...vocabMap.values()].map(v => v.vocabId))];
  const tracedSet = new Set([...vocabMap.values()].filter(v => v.isTraced).map(v => v.vocabId));
  const scoreMap = new Map<string, number>();
  if (vocabIds.length) {
    const encounters = await db.encounters.where('vocabId').anyOf(vocabIds).toArray();
    const grouped = new Map<string, { source: string }[]>();
    for (const e of encounters) {
      const arr = grouped.get(e.vocabId) || [];
      arr.push(e);
      grouped.set(e.vocabId, arr);
    }
    for (const [vid, encs] of grouped) scoreMap.set(vid, calculateWeightedScore(encs, tracedSet.has(vid) ? 2 : 1));
  }
  return traces.map(t => {
    const info = vocabMap.get(normalizeLemma(t.sourceText));
    return { ...t, weightedScore: info ? scoreMap.get(info.vocabId) : undefined };
  });
}

export async function handleGetTraces(payload: unknown): Promise<{ traces: TraceWithScore[]; total: number }> {
  const { limit = 50, offset = 0, search, ids } = (payload as GetTracesPayload) || {};

  let query = db.traces.orderBy('createdAt').reverse();

  if (ids) {
    if (ids.length === 0) {
      return { traces: [], total: 0 };
    }

    const traces = await db.traces.where('traceId').anyOf(ids).toArray();
    // Sort manually since anyOf doesn't preserve order or support complex sorting easily
    traces.sort((a, b) => b.createdAt - a.createdAt);
    
    // Apply search if needed
    let filtered = traces;
    if (search?.trim()) {
      const searchLower = search.toLowerCase();
      filtered = traces.filter(t =>
        t.sourceText.toLowerCase().includes(searchLower) ||
        t.translatedText.toLowerCase().includes(searchLower)
      );
    }
    
    return {
      traces: await enrichWithScores(filtered),
      total: filtered.length,
    };
  }

  if (search?.trim()) {
    const searchLower = search.toLowerCase();
    const all = await query.toArray();
    const filtered = all.filter(t =>
      t.sourceText.toLowerCase().includes(searchLower) ||
      t.translatedText.toLowerCase().includes(searchLower)
    );
    return {
      traces: await enrichWithScores(filtered.slice(offset, offset + limit)),
      total: filtered.length,
    };
  }

  const total = await db.traces.count();
  const traces = await query.offset(offset).limit(limit).toArray();

  return { traces: await enrichWithScores(traces), total };
}

export async function handleGetAllVocab(): Promise<{ vocab: { traceId: string; sourceText: string }[] }> {
  const traces = await db.traces.toArray();
  const vocab = traces.map(t => ({
    traceId: t.traceId,
    sourceText: t.sourceText
  }));
  return { vocab };
}

export async function handleTranslateTrace(payload: unknown): Promise<{ translatedText: string }> {
  const { traceId } = payload as { traceId: string };
  const trace = await db.traces.get(traceId);
  if (!trace) throw new AppError('NOT_FOUND', 'trace not found', false);
  if (trace.translatedText) return { translatedText: trace.translatedText };

  const result = await handleTranslateSelection({ sourceText: trace.sourceText, mode: trace.styleMode });
  await db.traces.update(traceId, { translatedText: result.translatedText, updatedAt: Date.now() });
  return { translatedText: result.translatedText };
}
