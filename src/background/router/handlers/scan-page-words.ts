import { db, VocabEntity, LemmaStatEntity } from '../../storage/db';
import { normalizeLemma, calculateWeightedScore } from '../../../lib/domain-utils';
import { AppError } from '../../types/errors';
import { ScanPageWordsPayload, ScanPageWordsResult, ScanPageWordsResultItem, ScanPageWordsStats } from '../../types/protocol';
import { handleRecordEncounter } from './encounters';
import { getEnabledWordbankWords } from './wordbanks';
import { dictionaryService } from '../../storage/dictionary';

const VALID_WORD_RE = /^[a-z]{2,}$/;

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .split(/[\s,.;:!?()[\]{}"'`~<>/\|+\-=_*&#@]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export async function handleScanPageWords(payload: unknown): Promise<ScanPageWordsResult> {
  const data = payload as ScanPageWordsPayload;

  if (!data?.pageUrl) {
    throw new AppError('VALIDATION_ERROR', 'pageUrl is required', false);
  }

  // Tokenize input
  let tokens: string[] = [];
  if (data.sentences?.length) {
    for (const sentence of data.sentences) tokens.push(...tokenize(sentence));
  } else {
    tokens = data.tokens?.length ? data.tokens : (data.textContent ? tokenize(data.textContent) : []);
  }
  if (!tokens.length) return { matches: [], stats: { coverage: 0, mastered: 0, topMissedWords: [] } };

  // Build normalized token frequency map
  const tokenMap = new Map<string, number>();
  for (const t of tokens) {
    const n = normalizeLemma(t);
    if (n) tokenMap.set(n, (tokenMap.get(n) || 0) + 1);
  }

  const now = Date.now();
  const pageHost = new URL(data.pageUrl).hostname;

  // Load settings
  const settingsKV = await db.settings.toArray();
  const prefs = new Map(settingsKV.map(s => [s.key, s.value]));
  const promotionMinCount = Number(prefs.get('promotionMinCount') ?? 6);
  const promotionMinPages = Number(prefs.get('promotionMinPages') ?? 3);
  const environmentRankThreshold = Number(prefs.get('environmentRankThreshold') ?? 2000);
  const noiseWordbankId = String(prefs.get('noiseWordbankId') ?? 'wb_primary');
  const noiseManualAddRaw = prefs.get('noiseManualAdd');
  const noiseManualRemoveRaw = prefs.get('noiseManualRemove');
  const noiseManualAdd = new Set<string>(
    Array.isArray(noiseManualAddRaw)
      ? (noiseManualAddRaw as unknown[]).map(v => normalizeLemma(String(v ?? ''))).filter(Boolean)
      : []
  );
  const noiseManualRemove = new Set<string>(
    Array.isArray(noiseManualRemoveRaw)
      ? (noiseManualRemoveRaw as unknown[]).map(v => normalizeLemma(String(v ?? ''))).filter(Boolean)
      : []
  );

  // Ensure dictionary loaded for rank gating
  await dictionaryService.ensureLoaded();

  // Get wordbank membership (before dictionary gate so wordbank words bypass rank filter)
  const wordbankWords = await getEnabledWordbankWords();
  const wordbankSet = new Set(wordbankWords.keys());

  // ── Layer 0: Dictionary gate ──
  // Filter page tokens to valid dictionary words above rank threshold;
  // wordbank words always pass regardless of rank.
  const qualifiedTokens = new Map<string, number>();
  for (const [normalized, count] of tokenMap) {
    if (!VALID_WORD_RE.test(normalized)) continue;
    if (wordbankSet.has(normalized)) {
      qualifiedTokens.set(normalized, count);
      continue;
    }
    const entry = dictionaryService.lookup(normalized);
    if (entry && (entry.rank === undefined || entry.rank >= environmentRankThreshold)) {
      qualifiedTokens.set(normalized, count);
    }
  }

  // ── Batch upsert lemmaStats for ALL qualified words ──
  const existingStats = await db.lemmaStats
    .where('normalizedLemma')
    .anyOf([...qualifiedTokens.keys()])
    .toArray();
  const statsByLemma = new Map(existingStats.map(s => [s.normalizedLemma, s]));

  const statsToUpdate: LemmaStatEntity[] = [];
  const statsToAdd: LemmaStatEntity[] = [];

  for (const [normalized, count] of qualifiedTokens) {
    const existing = statsByLemma.get(normalized);
    const isNewPage = !existing || existing.lastPageUrl !== data.pageUrl;
    const dictEntry = dictionaryService.lookup(normalized);

    if (existing) {
      existing.totalCount += count;
      if (isNewPage) existing.pageCount += 1;
      existing.lastSeenAt = now;
      existing.lastPageUrl = data.pageUrl;
      existing.lastPageHost = pageHost;
      existing.inWordbank = wordbankSet.has(normalized);
      existing.dictRank = dictEntry?.rank;
      existing.updatedAt = now;
      statsToUpdate.push(existing);
    } else {
      const stat: LemmaStatEntity = {
        lemmaStatId: crypto.randomUUID(),
        lemma: dictEntry?.lemma ?? normalized,
        normalizedLemma: normalized,
        language: data.language ?? 'en',
        totalCount: count,
        pageCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        lastPageUrl: data.pageUrl,
        lastPageHost: pageHost,
        inWordbank: wordbankSet.has(normalized),
        sourceMask: 0,
        dictRank: dictEntry?.rank,
        updatedAt: now,
      };
      statsToAdd.push(stat);
      statsByLemma.set(normalized, stat);
    }
  }

  // Persist lemmaStats
  if (statsToAdd.length) await db.lemmaStats.bulkAdd(statsToAdd);
  if (statsToUpdate.length) await db.lemmaStats.bulkPut(statsToUpdate);

  // ── Promotion: eligible lemmaStats → vocabulary ──
  const promotionCandidates = [...statsByLemma.values()].filter(s =>
    !s.promotedVocabId &&
    s.totalCount >= promotionMinCount &&
    s.pageCount >= promotionMinPages &&
    (!s.cooldownUntil || s.cooldownUntil < now)
  );

  const pendingNewVocab = new Map<string, VocabEntity>();
  for (const stat of promotionCandidates) {
    const existingVocab = await db.vocabulary
      .where('[lemma+language]')
      .equals([stat.lemma, stat.language])
      .first();
    if (existingVocab) {
      stat.promotedVocabId = existingVocab.vocabId;
      stat.promotedAt = now;
      stat.promotionReason = 'threshold';
      await db.lemmaStats.update(stat.lemmaStatId, {
        promotedVocabId: existingVocab.vocabId,
        promotedAt: now,
        promotionReason: 'threshold',
      });
      continue;
    }

    let shouldLockAsNoise = false;
    if (noiseWordbankId && stat.inWordbank) {
      const wbWord = wordbankWords.get(stat.normalizedLemma);
      if (wbWord?.sourceWordbankIds.includes(noiseWordbankId)) shouldLockAsNoise = true;
    }
    if (noiseManualAdd.has(stat.normalizedLemma)) shouldLockAsNoise = true;
    if (noiseManualRemove.has(stat.normalizedLemma)) shouldLockAsNoise = false;

    const vocabId = crypto.randomUUID();
    const wbWord = wordbankWords.get(stat.normalizedLemma);
    const newVocab: VocabEntity = {
      vocabId,
      lemma: stat.lemma,
      surface: wbWord?.surface ?? stat.lemma,
      language: stat.language,
      meaning: '',
      proficiency: 0,
      sourceType: stat.inWordbank ? 'wordbank' : 'ai',
      sourceWordbankId: wbWord?.wordbankId,
      scoreLocked: shouldLockAsNoise,
      noiseManaged: shouldLockAsNoise,
      familiarityScore: shouldLockAsNoise ? 100 : 0,
      isKnown: shouldLockAsNoise,
      firstSeenAt: stat.firstSeenAt,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    pendingNewVocab.set(vocabId, newVocab);

    stat.promotedVocabId = vocabId;
    stat.promotedAt = now;
    stat.promotionReason = 'threshold';
    await db.lemmaStats.update(stat.lemmaStatId, {
      promotedVocabId: vocabId,
      promotedAt: now,
      promotionReason: 'threshold',
    });
  }

  // Persist promoted vocab
  if (pendingNewVocab.size) {
    await db.vocabulary.bulkAdd([...pendingNewVocab.values()]);
  }

  // ── Layer 1: Wordbank words on page ──
  const allVocab = await db.vocabulary
    .filter(v => !v.deletedAt && (!data.language || v.language === data.language))
    .toArray();
  const vocabByLemma = new Map(allVocab.map(v => [normalizeLemma(v.lemma), v]));

  // Also create pending vocab for wordbank words not yet in vocabulary
  const wordbankPending = new Map<string, VocabEntity>();
  for (const [normalized, wbWord] of wordbankWords) {
    if (qualifiedTokens.has(normalized) && !vocabByLemma.has(normalized)) {
      let shouldLockAsNoise = false;
      if (noiseWordbankId && wbWord.sourceWordbankIds.includes(noiseWordbankId)) shouldLockAsNoise = true;
      if (noiseManualAdd.has(normalized)) shouldLockAsNoise = true;
      if (noiseManualRemove.has(normalized)) shouldLockAsNoise = false;

      const newVocab: VocabEntity = {
        vocabId: crypto.randomUUID(),
        lemma: wbWord.lemma,
        surface: wbWord.surface,
        language: 'en',
        meaning: '',
        proficiency: 0,
        sourceType: 'wordbank',
        sourceWordbankId: wbWord.wordbankId,
        scoreLocked: shouldLockAsNoise,
        noiseManaged: shouldLockAsNoise,
        familiarityScore: shouldLockAsNoise ? 100 : 0,
        isKnown: shouldLockAsNoise,
        firstSeenAt: now,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      };
      wordbankPending.set(newVocab.vocabId, newVocab);
      vocabByLemma.set(normalized, newVocab);

      // Mark lemmaStats as wordbank-promoted
      const stat = statsByLemma.get(normalized);
      if (stat && !stat.promotedVocabId) {
        stat.promotedVocabId = newVocab.vocabId;
        stat.promotedAt = now;
        stat.promotionReason = 'wordbank';
        await db.lemmaStats.update(stat.lemmaStatId, {
          promotedVocabId: newVocab.vocabId,
          promotedAt: now,
          promotionReason: 'wordbank',
        });
      }
    }
  }

  // Match vocab against page tokens
  const matched = [...vocabByLemma.values()].filter(v => qualifiedTokens.has(normalizeLemma(v.lemma)));
  if (!matched.length) return { matches: [], stats: { coverage: 0, mastered: 0, topMissedWords: [] } };

  // Batch fetch encounters
  const ids = matched.map(v => v.vocabId);
  const encounterData = new Map<string, { count: number; score: number; encounters: { source: string }[] }>();
  if (ids.length > 0) {
    const encounters = await db.encounters.where('vocabId').anyOf(ids).toArray();
    for (const e of encounters) {
      const d = encounterData.get(e.vocabId) || { count: 0, score: 0, encounters: [] };
      d.count++;
      d.encounters.push({ source: e.source });
      encounterData.set(e.vocabId, d);
    }
    for (const [vid, d] of encounterData) {
      const v = matched.find(m => m.vocabId === vid);
      d.score = calculateWeightedScore(d.encounters, v?.isTraced ? 2 : 1);
      encounterData.set(vid, d);
    }
  }

  // Build result items with source/priority labels
  const allMatches: ScanPageWordsResultItem[] = matched.map(v => {
    const normalized = normalizeLemma(v.lemma);
    const eData = encounterData.get(v.vocabId);
    const encCount = eData?.count || 0;

    let source: ScanPageWordsResultItem['source'];
    if (v.isTraced) source = 'traced';
    else if (v.sourceWordbankId || wordbankSet.has(normalized)) source = 'wordbank';
    else source = 'environment';

    return {
      vocabId: v.vocabId,
      lemma: v.lemma,
      surface: v.surface,
      proficiency: v.proficiency,
      encounterCount: encCount,
      weightedScore: eData?.score || 0,
      presentCount: qualifiedTokens.get(normalized) || 1,
      nextReviewDate: v.nextReviewDate,
      isKnown: v.isKnown,
      scoreLocked: v.scoreLocked,
      isTraced: v.isTraced,
      sourceWordbankId: v.sourceWordbankId,
      priority: encCount > 3 ? 'high' : 'normal',
      source,
    };
  });

  // Filter visible matches
  const matches = allMatches.filter(m => {
    const vocab = vocabByLemma.get(normalizeLemma(m.lemma));
    if (!vocab) return false;
    if (vocab.isTraced) return true;
    return !vocab.scoreLocked && !vocab.isKnown && m.weightedScore < 100;
  });

  // ── Stats computation ──
  const wordbankOnPage = [...qualifiedTokens.keys()].filter(n => wordbankSet.has(n)).length;
  const masteredWordbankCount = allMatches.filter(m => {
    const normalized = normalizeLemma(m.lemma);
    const isWordbankWord = wordbankSet.has(normalized) || !!m.sourceWordbankId;
    return isWordbankWord && (m.isKnown || m.weightedScore >= 100);
  }).length;
  const coverage = wordbankOnPage > 0 ? Math.round((masteredWordbankCount / wordbankOnPage) * 100) : 100;

  const missedWords = allMatches
    .filter(m => !m.isKnown && !m.scoreLocked && m.weightedScore < 100)
    .sort((a, b) => b.presentCount - a.presentCount)
    .slice(0, 3);

  const stats: ScanPageWordsStats = {
    coverage,
    mastered: coverage >= 100 ? 1 : 0,
    topMissedWords: missedWords.map(m => ({
      lemma: m.lemma,
      source: m.source || 'environment',
      presentCount: m.presentCount,
      encounterCount: m.encounterCount,
    })),
  };

  // ── Record encounters ──
  const recordableMatches = allMatches.filter(m => vocabByLemma.has(normalizeLemma(m.lemma)));
  if (data.record && recordableMatches.length > 0) {
    const vocabSentenceMap = new Map<string, string>();
    if (data.sentences?.length) {
      for (const sentence of data.sentences) {
        for (const t of tokenize(sentence)) {
          const normalized = normalizeLemma(t);
          const vocab = vocabByLemma.get(normalized);
          if (vocab && !vocabSentenceMap.has(vocab.vocabId)) {
            vocabSentenceMap.set(vocab.vocabId, sentence);
          }
        }
      }
    }

    // Persist pending wordbank vocab
    const vocabToPersist = recordableMatches
      .map(m => wordbankPending.get(m.vocabId))
      .filter((v): v is VocabEntity => !!v);
    if (vocabToPersist.length) await db.vocabulary.bulkAdd(vocabToPersist);

    const recordedVocabIds = new Set<string>();
    const promises: Promise<unknown>[] = [];
    for (const m of recordableMatches) {
      if (recordedVocabIds.has(m.vocabId)) continue;
      recordedVocabIds.add(m.vocabId);
      promises.push(handleRecordEncounter({
        vocabId: m.vocabId,
        word: m.surface,
        pageUrl: data.pageUrl,
        pageTitle: data.pageTitle,
        faviconUrl: data.faviconUrl,
        contextSentence: vocabSentenceMap.get(m.vocabId),
        source: 'scan',
        sourceWordbankId: vocabByLemma.get(normalizeLemma(m.lemma))?.sourceWordbankId,
      }).catch(console.error));
    }
    await Promise.all(promises);

    // ── Auto-trace pool: replenish traced words ──
    const autoTraceEnabled = prefs.get('autoTraceEnabled') !== false;
    const autoTracePoolSize = Number(prefs.get('autoTracePoolSize') ?? 30);
    const autoTraceMinEncounters = Number(prefs.get('autoTraceMinEncounters') ?? 3);
    if (autoTraceEnabled) {
      const currentTraced = await db.vocabulary
        .filter(v => v.isTraced === true && !v.isKnown && !v.deletedAt)
        .count();
      const slots = autoTracePoolSize - currentTraced;
      if (slots > 0) {
        // Candidates: all non-traced, non-known, non-locked vocab with encounters
        const candidates = await db.vocabulary
          .filter(v => !v.isTraced && !v.isKnown && !v.scoreLocked && !v.deletedAt && VALID_WORD_RE.test(v.lemma))
          .toArray();
        if (candidates.length > 0) {
          // Score by (encounter count × recency)
          const candidateIds = candidates.map(v => v.vocabId);
          const candEncounters = await db.encounters.where('vocabId').anyOf(candidateIds).toArray();
          const candStats = new Map<string, { count: number; lastSeen: number }>();
          for (const e of candEncounters) {
            const s = candStats.get(e.vocabId) || { count: 0, lastSeen: 0 };
            s.count++;
            if (e.createdAt > s.lastSeen) s.lastSeen = e.createdAt;
            candStats.set(e.vocabId, s);
          }
          const scored = candidates
            .filter(v => {
              const s = candStats.get(v.vocabId);
              if (!s || s.count < autoTraceMinEncounters) return false;
              // Must exist in dictionary or wordbank
              if (wordbankSet.has(v.lemma)) return true;
              const dictEntry = dictionaryService.lookup(v.lemma);
              return !!dictEntry;
            })
            .map(v => {
              const s = candStats.get(v.vocabId)!;
              const recencyDays = (now - s.lastSeen) / (24 * 60 * 60 * 1000);
              const recencyFactor = Math.max(0.1, 1 - recencyDays / 30);
              return { vocab: v, score: s.count * recencyFactor };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, slots);
          for (const { vocab } of scored) {
            await db.vocabulary.update(vocab.vocabId, { isTraced: true, updatedAt: now });
            // Reflect auto-trace in current scan results
            const m = matches.find(x => x.vocabId === vocab.vocabId);
            if (m) { m.isTraced = true; m.source = 'traced'; }
          }
        }
      }
    }
  }

  return { matches, stats };
}
