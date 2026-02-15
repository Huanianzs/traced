import { db, EncounterEntity } from '../../storage/db';
import { normalizeLemma } from '../../../lib/domain-utils';
import { AppError } from '../../types/errors';
import { GetWordEncountersPayload, GetWordEncountersResult, RecordEncounterPayload } from '../../types/protocol';
import { handleUpsertVocab, cleanupOrphanedVocab, resetNoiseWordFields, recalcVocabScore } from './vocab';

export async function handleRecordEncounter(payload: unknown): Promise<EncounterEntity> {
  const data = payload as RecordEncounterPayload;

  if (!data?.pageUrl?.trim()) {
    throw new AppError('VALIDATION_ERROR', 'pageUrl is required', false);
  }

  const now = Date.now();
  let vocabId = data.vocabId;
  let surface = data.word || '';

  if (!vocabId) {
    if (!data.word?.trim()) {
      throw new AppError('VALIDATION_ERROR', 'word or vocabId is required', false);
    }
    const vocab = await handleUpsertVocab({
      lemma: normalizeLemma(data.word),
      surface: data.word,
      language: data.language || 'en'
    });
    vocabId = vocab.vocabId;
    surface = vocab.surface;
  } else {
    const vocab = await db.vocabulary.get(vocabId);
    if (!vocab || vocab.deletedAt) {
      throw new AppError('NOT_FOUND', 'vocabulary not found', false);
    }
    surface = surface || vocab.surface || vocab.lemma;
  }

  let pageHost: string;
  try {
    pageHost = new URL(data.pageUrl).host;
  } catch {
    throw new AppError('VALIDATION_ERROR', 'invalid pageUrl', false);
  }

  // 24-hour dedup for scan/lookup source: update existing instead of creating new
  if (data.source === 'scan' || data.source === 'lookup' || data.source === 'wordbank') {
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const recent = await db.encounters
      .where('vocabId').equals(vocabId)
      .filter(e => e.pageUrl === data.pageUrl && e.source === data.source && e.createdAt > dayAgo)
      .first();
    if (recent) {
      await db.encounters.update(recent.encounterId, { updatedAt: now });
      return recent;
    }
  }

  const encounter: EncounterEntity = {
    encounterId: crypto.randomUUID(),
    vocabId,
    surface,
    normalizedSurface: normalizeLemma(surface),
    pageUrl: data.pageUrl,
    pageHost,
    pageTitle: data.pageTitle,
    faviconUrl: data.faviconUrl,
    contextSentence: data.contextSentence,
    locator: data.locator,
    source: data.source || 'scan',
    createdAt: now,
    updatedAt: now
  };

  await db.encounters.add(encounter);

  await recalcVocabScore(vocabId);

  // Auto-unlock noise word after 2 lookup encounters
  if (encounter.source === 'lookup') {
    const vocab = await db.vocabulary.get(vocabId);
    if (vocab?.scoreLocked) {
      const lookupCount = await db.encounters
        .where('vocabId').equals(vocabId)
        .filter(e => e.source === 'lookup')
        .count();
      if (lookupCount >= 2) {
        await resetNoiseWordFields(vocabId);
      }
    }
  }

  return encounter;
}

export async function handleGetWordEncounters(payload: unknown): Promise<GetWordEncountersResult> {
  const { vocabId, limit = 50, offset = 0, pageHost, pageUrl } = payload as GetWordEncountersPayload;

  if (!vocabId) {
    throw new AppError('VALIDATION_ERROR', 'vocabId is required', false);
  }

  let records = await db.encounters.where('vocabId').equals(vocabId).sortBy('createdAt');
  records.reverse();

  if (pageHost) {
    records = records.filter(e => e.pageHost === pageHost);
  }
  if (pageUrl) {
    records = records.filter(e => e.pageUrl === pageUrl);
  }

  return {
    encounters: records.slice(offset, offset + limit),
    total: records.length
  };
}

export async function handleDeleteEncounter(payload: unknown): Promise<{ success: boolean; vocabDeleted?: boolean }> {
  const { encounterId } = payload as { encounterId?: string };
  if (!encounterId) {
    throw new AppError('VALIDATION_ERROR', 'encounterId is required', false);
  }

  const encounter = await db.encounters.get(encounterId);
  if (!encounter) {
    return { success: true };
  }

  await db.encounters.delete(encounterId);

  // Check if vocab has any remaining encounters
  const vocabDeleted = await cleanupOrphanedVocab(encounter.vocabId);

  if (!vocabDeleted) {
    if (encounter.source === 'trace') {
      const lemma = normalizeLemma(encounter.normalizedSurface || encounter.surface);
      const remainingTrace = await db.traces.filter(t => normalizeLemma(t.sourceText) === lemma).first();
      if (!remainingTrace) {
        await db.vocabulary.update(encounter.vocabId, { isTraced: false, updatedAt: Date.now() });
      }
    }
    await recalcVocabScore(encounter.vocabId);
  }

  return { success: true, vocabDeleted };
}
