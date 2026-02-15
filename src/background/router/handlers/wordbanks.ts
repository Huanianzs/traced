import { db, WordbankEntity, UserWordbankEntity, WordbankWordEntity, VocabEntity } from '../../storage/db';
import { normalizeLemma } from '../../../lib/domain-utils';
import { AppError } from '../../types/errors';
import {
  VIRTUAL_ENV_WORDBANK_ID,
  ListWordbanksPayload,
  CreateWordbankPayload,
  DeleteWordbankPayload,
  UpsertUserWordbanksPayload,
  GetWordbankStatsPayload,
  GetWordbankStatsResult,
  WordbankDTO,
  WordbankStatsItem,
  ImportWordbankWordsPayload,
  GetWordbankWordsPayload,
  GetWordbankWordsResult,
  WordbankWordDTO
} from '../../types/protocol';

const WORDBANK_SELECTION_PRIORITY: Record<string, number> = {
  daily: 10,
  programming: 20,
  cet4: 30,
  cet6: 40,
  gaokao: 50,
  postgrad: 60,
  primary: 70,
  top10k: 80,
  custom: 90,
  noise: 100,
};

function shouldPreferWordbank(
  candidateId: string,
  currentId: string,
  codeById: Map<string, string>
): boolean {
  const candidateCode = codeById.get(candidateId) || 'custom';
  const currentCode = codeById.get(currentId) || 'custom';
  const candidatePriority = WORDBANK_SELECTION_PRIORITY[candidateCode] ?? 999;
  const currentPriority = WORDBANK_SELECTION_PRIORITY[currentCode] ?? 999;

  if (candidatePriority !== currentPriority) return candidatePriority < currentPriority;
  return candidateId < currentId;
}

export async function handleListWordbanks(payload: unknown): Promise<{ items: WordbankDTO[]; envWordCount: number }> {
  const { language, includeDeleted } = (payload as ListWordbanksPayload) || {};

  let wordbanks = await db.wordbanks.toArray();
  if (language) {
    wordbanks = wordbanks.filter(wb => wb.language === language);
  }
  if (!includeDeleted) {
    wordbanks = wordbanks.filter(wb => !wb.deletedAt);
  }

  const userWordbanks = await db.userWordbanks.toArray();
  const enabledMap = new Map(userWordbanks.map(uw => [uw.wordbankId, uw.enabled]));

  const envWordCount = await db.vocabulary
    .filter(v => !v.deletedAt && v.sourceType === 'ai' && !v.sourceWordbankId && !v.scoreLocked)
    .count();

  return {
    items: wordbanks.map(wb => ({
      wordbankId: wb.wordbankId,
      code: wb.code,
      name: wb.name,
      description: wb.description,
      language: wb.language,
      builtIn: wb.builtIn,
      wordCount: wb.wordCount,
      enabled: enabledMap.get(wb.wordbankId) ?? false
    })),
    envWordCount
  };
}

export async function handleCreateWordbank(payload: unknown): Promise<WordbankDTO> {
  const { name, description, language = 'en' } = (payload as CreateWordbankPayload) || {};

  if (!name?.trim()) {
    throw new AppError('VALIDATION_ERROR', 'name is required', false);
  }

  const trimmedName = name.trim();
  const lang = language.trim() || 'en';

  const duplicate = await db.wordbanks
    .filter(wb => !wb.deletedAt && wb.language === lang && wb.name.trim().toLowerCase() === trimmedName.toLowerCase())
    .first();
  if (duplicate) {
    throw new AppError('VALIDATION_ERROR', 'Wordbank name already exists', false);
  }

  const now = Date.now();
  const wordbankId = crypto.randomUUID();

  const wordbank: WordbankEntity = {
    wordbankId,
    code: 'custom',
    name: trimmedName,
    description: description?.trim() || undefined,
    language: lang,
    builtIn: false,
    enabledByDefault: false,
    version: '1.0.0',
    wordCount: 0,
    createdAt: now,
    updatedAt: now
  };

  const userWordbank: UserWordbankEntity = {
    userWordbankId: crypto.randomUUID(),
    wordbankId,
    enabled: true,
    createdAt: now,
    updatedAt: now
  };

  await db.transaction('rw', db.wordbanks, db.userWordbanks, async () => {
    await db.wordbanks.add(wordbank);
    await db.userWordbanks.add(userWordbank);
  });

  return {
    wordbankId,
    code: wordbank.code,
    name: wordbank.name,
    description: wordbank.description,
    language: wordbank.language,
    builtIn: false,
    wordCount: 0,
    enabled: true
  };
}

export async function handleDeleteWordbank(payload: unknown): Promise<{ success: true }> {
  const { wordbankId } = (payload as DeleteWordbankPayload) || {};
  if (!wordbankId) {
    throw new AppError('VALIDATION_ERROR', 'wordbankId is required', false);
  }
  if (wordbankId === VIRTUAL_ENV_WORDBANK_ID) {
    throw new AppError('VALIDATION_ERROR', 'Virtual wordbank cannot be deleted', false);
  }

  const wordbank = await db.wordbanks.get(wordbankId);
  if (!wordbank || wordbank.deletedAt) {
    throw new AppError('NOT_FOUND', 'Wordbank not found', false);
  }
  if (wordbank.builtIn) {
    throw new AppError('VALIDATION_ERROR', 'Built-in wordbank cannot be deleted', false);
  }

  await db.transaction('rw', db.wordbanks, db.wordbankWords, db.userWordbanks, async () => {
    await db.wordbankWords.where('wordbankId').equals(wordbankId).delete();
    await db.userWordbanks.where('wordbankId').equals(wordbankId).delete();
    await db.wordbanks.delete(wordbankId);
  });

  return { success: true };
}

export async function handleGetUserWordbanks(): Promise<{ items: Array<UserWordbankEntity & { wordbank: WordbankEntity }> }> {
  const userWordbanks = await db.userWordbanks.toArray();
  const wordbanks = await db.wordbanks.toArray();
  const wbMap = new Map(wordbanks.map(wb => [wb.wordbankId, wb]));

  return {
    items: userWordbanks
      .filter(uw => wbMap.has(uw.wordbankId))
      .map(uw => ({
        ...uw,
        wordbank: wbMap.get(uw.wordbankId)!
      }))
  };
}

export async function handleUpsertUserWordbanks(payload: unknown): Promise<{ success: true }> {
  const { selections } = payload as UpsertUserWordbanksPayload;
  if (!selections?.length) {
    throw new AppError('VALIDATION_ERROR', 'selections is required', false);
  }

  const now = Date.now();

  for (const sel of selections) {
    const existing = await db.userWordbanks.where('wordbankId').equals(sel.wordbankId).first();
    if (existing) {
      await db.userWordbanks.update(existing.userWordbankId, {
        enabled: sel.enabled,
        updatedAt: now
      });
    } else {
      await db.userWordbanks.add({
        userWordbankId: crypto.randomUUID(),
        wordbankId: sel.wordbankId,
        enabled: sel.enabled,
        createdAt: now,
        updatedAt: now
      });
    }
  }

  return { success: true };
}

export async function handleGetWordbankStats(payload: unknown): Promise<GetWordbankStatsResult> {
  const { wordbankIds } = (payload as GetWordbankStatsPayload) || {};

  const wordbanks = await db.wordbanks.toArray();
  const allUserWordbanks = await db.userWordbanks.toArray();
  const enabledIds = new Set(allUserWordbanks.filter(uw => uw.enabled).map(uw => uw.wordbankId));

  const targetWordbanks = wordbankIds?.length
    ? wordbanks.filter(wb => wordbankIds.includes(wb.wordbankId))
    : wordbanks.filter(wb => !wb.deletedAt && enabledIds.has(wb.wordbankId));

  const allVocab = await db.vocabulary.filter(v => !v.deletedAt).toArray();
  const vocabByWordbank = new Map<string, VocabEntity[]>();

  for (const v of allVocab) {
    if (v.sourceWordbankId) {
      const list = vocabByWordbank.get(v.sourceWordbankId) || [];
      list.push(v);
      vocabByWordbank.set(v.sourceWordbankId, list);
    }
  }

  const items: WordbankStatsItem[] = targetWordbanks.map(wb => {
    const vocabList = vocabByWordbank.get(wb.wordbankId) || [];
    const encountered = vocabList.length;
    const mastered = vocabList.filter(v => v.proficiency >= 4).length;
    const learning = vocabList.filter(v => v.proficiency >= 1 && v.proficiency <= 3).length;
    const newCount = vocabList.filter(v => v.proficiency === 0).length;

    return {
      wordbankId: wb.wordbankId,
      code: wb.code,
      name: wb.name,
      total: wb.wordCount,
      encountered,
      mastered,
      learning,
      newCount,
      masteryRate: wb.wordCount > 0 ? mastered / wb.wordCount : 0
    };
  });

  // Append virtual environment wordbank stats (only when no specific filter, or filter includes __env__)
  if (!wordbankIds?.length || wordbankIds.includes(VIRTUAL_ENV_WORDBANK_ID)) {
    const envVocab = allVocab.filter(v => v.sourceType === 'ai' && !v.sourceWordbankId && !v.scoreLocked);
    const envTotal = envVocab.length;
    const envMastered = envVocab.filter(v => v.proficiency >= 4).length;
    const envLearning = envVocab.filter(v => v.proficiency >= 1 && v.proficiency <= 3).length;
    const envNew = envVocab.filter(v => v.proficiency === 0).length;
    items.push({
      wordbankId: VIRTUAL_ENV_WORDBANK_ID,
      code: 'environment',
      name: 'Environment Words',
      total: envTotal,
      encountered: envTotal,
      mastered: envMastered,
      learning: envLearning,
      newCount: envNew,
      masteryRate: envTotal > 0 ? envMastered / envTotal : 0,
    });
  }

  const totalVocabulary = allVocab.length;
  const totalMastered = allVocab.filter(v => v.proficiency >= 4).length;

  return {
    items,
    summary: {
      totalVocabulary,
      totalMastered,
      overallMasteryRate: totalVocabulary > 0 ? totalMastered / totalVocabulary : 0
    }
  };
}

export async function handleImportWordbankWords(payload: unknown): Promise<{ imported: number }> {
  const { wordbankId, words } = payload as ImportWordbankWordsPayload;

  if (!wordbankId || !words?.length) {
    throw new AppError('VALIDATION_ERROR', 'wordbankId and words are required', false);
  }
  if (wordbankId === VIRTUAL_ENV_WORDBANK_ID) {
    throw new AppError('VALIDATION_ERROR', 'Cannot import into virtual wordbank', false);
  }

  const wordbank = await db.wordbanks.get(wordbankId);
  if (!wordbank) {
    throw new AppError('NOT_FOUND', 'Wordbank not found', false);
  }

  const now = Date.now();
  const toAdd: WordbankWordEntity[] = words.map((w, i) => ({
    wordId: crypto.randomUUID(),
    wordbankId,
    lemma: normalizeLemma(w.lemma),
    surface: w.surface || w.lemma,
    normalized: normalizeLemma(w.lemma),
    language: wordbank.language,
    rank: w.rank ?? i,
    createdAt: now
  }));

  await db.wordbankWords.bulkAdd(toAdd);
  await db.wordbanks.update(wordbankId, {
    wordCount: wordbank.wordCount + toAdd.length,
    updatedAt: now
  });

  return { imported: toAdd.length };
}

// Get enabled wordbank words for scanning
export async function getEnabledWordbankWords(): Promise<Map<string, { wordbankId: string; lemma: string; surface: string; sourceWordbankIds: string[] }>> {
  const allUserWordbanks = await db.userWordbanks.toArray();
  const enabledUserWordbanks = allUserWordbanks.filter(uw => uw.enabled);
  if (!enabledUserWordbanks.length) return new Map();

  const enabledIds = enabledUserWordbanks.map(uw => uw.wordbankId);
  const enabledWordbanks = await db.wordbanks.where('wordbankId').anyOf(enabledIds).toArray();
  const codeById = new Map(enabledWordbanks.map(wb => [wb.wordbankId, wb.code]));
  const words = await db.wordbankWords.where('wordbankId').anyOf(enabledIds).toArray();

  const map = new Map<string, { wordbankId: string; lemma: string; surface: string; sourceWordbankIds: string[] }>();
  for (const w of words) {
    const existing = map.get(w.normalized);
    if (!existing) {
      map.set(w.normalized, {
        wordbankId: w.wordbankId,
        lemma: w.lemma,
        surface: w.surface,
        sourceWordbankIds: [w.wordbankId]
      });
      continue;
    }

    if (!existing.sourceWordbankIds.includes(w.wordbankId)) {
      existing.sourceWordbankIds.push(w.wordbankId);
    }

    if (shouldPreferWordbank(w.wordbankId, existing.wordbankId, codeById)) {
      existing.wordbankId = w.wordbankId;
      existing.lemma = w.lemma;
      existing.surface = w.surface;
    }
  }
  return map;
}

export async function handleGetWordbankWords(payload: unknown): Promise<GetWordbankWordsResult> {
  const {
    wordbankId,
    limit = 50,
    offset = 0,
    filter = 'all',
    sortBy = 'rank',
    sortOrder = 'asc'
  } = (payload as GetWordbankWordsPayload) || {};

  if (!wordbankId) {
    throw new AppError('VALIDATION_ERROR', 'wordbankId is required', false);
  }

  // Virtual environment wordbank: query vocabulary table directly
  if (wordbankId === VIRTUAL_ENV_WORDBANK_ID) {
    const envVocab = await db.vocabulary
      .filter(v => !v.deletedAt && v.sourceType === 'ai' && !v.sourceWordbankId && !v.scoreLocked)
      .toArray();
    const total = envVocab.length;

    const vocabIds = envVocab.map(v => v.vocabId);
    const encounters = vocabIds.length ? await db.encounters.where('vocabId').anyOf(vocabIds).toArray() : [];
    const encounterCounts = new Map<string, number>();
    for (const e of encounters) {
      encounterCounts.set(e.vocabId, (encounterCounts.get(e.vocabId) || 0) + 1);
    }

    let items: WordbankWordDTO[] = envVocab.map(v => ({
      wordId: v.vocabId,
      lemma: v.lemma,
      surface: v.surface,
      rank: undefined,
      vocabId: v.vocabId,
      proficiency: v.proficiency,
      encounterCount: encounterCounts.get(v.vocabId) || 0,
      lastSeenAt: v.lastSeenAt,
    }));

    if (filter === 'mastered') {
      items = items.filter(w => w.proficiency !== undefined && w.proficiency >= 4);
    } else if (filter === 'learning') {
      items = items.filter(w => w.proficiency !== undefined && w.proficiency >= 1 && w.proficiency <= 3);
    } else if (filter === 'not_encountered') {
      items = [];
    }

    const filteredTotal = items.length;

    // Env words have no rank; default sort by lastSeenAt desc
    items.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'rank') {
        cmp = (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0);
      } else if (sortBy === 'proficiency') {
        cmp = (a.proficiency ?? -1) - (b.proficiency ?? -1);
      } else if (sortBy === 'encounters') {
        cmp = (a.encounterCount ?? 0) - (b.encounterCount ?? 0);
      }
      return sortBy === 'rank' ? cmp : (sortOrder === 'desc' ? -cmp : cmp);
    });

    items = items.slice(offset, offset + limit);
    return { items, total, filteredTotal };
  }

  // Get all words from wordbank
  const allWords = await db.wordbankWords.where('wordbankId').equals(wordbankId).toArray();
  const total = allWords.length;

  // Get vocabulary data for encountered words
  const vocabList = await db.vocabulary.where('sourceWordbankId').equals(wordbankId).toArray();
  const vocabMap = new Map(vocabList.map(v => [v.lemma, v]));

  // Get encounter counts
  const vocabIds = vocabList.map(v => v.vocabId);
  const encounters = vocabIds.length ? await db.encounters.where('vocabId').anyOf(vocabIds).toArray() : [];
  const encounterCounts = new Map<string, number>();
  for (const e of encounters) {
    encounterCounts.set(e.vocabId, (encounterCounts.get(e.vocabId) || 0) + 1);
  }

  // Build result with vocab data
  let items: WordbankWordDTO[] = allWords.map(w => {
    const vocab = vocabMap.get(w.lemma);
    return {
      wordId: w.wordId,
      lemma: w.lemma,
      surface: w.surface,
      rank: w.rank,
      vocabId: vocab?.vocabId,
      proficiency: vocab?.proficiency,
      encounterCount: vocab ? (encounterCounts.get(vocab.vocabId) || 0) : 0,
      lastSeenAt: vocab?.lastSeenAt
    };
  });

  // Apply filter
  if (filter === 'encountered') {
    items = items.filter(w => w.vocabId);
  } else if (filter === 'not_encountered') {
    items = items.filter(w => !w.vocabId);
  } else if (filter === 'mastered') {
    items = items.filter(w => w.proficiency !== undefined && w.proficiency >= 4);
  } else if (filter === 'learning') {
    items = items.filter(w => w.proficiency !== undefined && w.proficiency >= 1 && w.proficiency <= 3);
  }

  const filteredTotal = items.length;

  // Sort
  items.sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'rank') {
      cmp = (a.rank ?? 0) - (b.rank ?? 0);
    } else if (sortBy === 'proficiency') {
      cmp = (a.proficiency ?? -1) - (b.proficiency ?? -1);
    } else if (sortBy === 'encounters') {
      cmp = (a.encounterCount ?? 0) - (b.encounterCount ?? 0);
    }
    return sortOrder === 'desc' ? -cmp : cmp;
  });

  // Paginate
  items = items.slice(offset, offset + limit);

  return { items, total, filteredTotal };
}
