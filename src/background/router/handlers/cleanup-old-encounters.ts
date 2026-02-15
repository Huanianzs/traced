import { db } from '../../storage/db';
import { CleanupOldEncountersPayload, CleanupOldEncountersResult } from '../../types/protocol';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function handleCleanupOldEncounters(payload: unknown): Promise<CleanupOldEncountersResult> {
  const data = (payload as CleanupOldEncountersPayload) || {};
  const now = Date.now();

  const settingsKV = await db.settings.toArray();
  const prefs = new Map(settingsKV.map(s => [s.key, s.value]));
  const cleanupAgeDays = Number(data.cleanupAgeDays ?? prefs.get('cleanupAgeDays') ?? 30);
  const cleanupMinCount = Number(data.cleanupMinCount ?? prefs.get('cleanupMinCount') ?? 3);
  const dryRun = data.dryRun === true;

  const cutoff = now - Math.max(1, cleanupAgeDays) * DAY_MS;

  const staleLemmaStats = await db.lemmaStats
    .where('lastSeenAt')
    .below(cutoff)
    .and(s => s.totalCount < cleanupMinCount && !s.promotedVocabId)
    .toArray();

  const staleLemmaSet = new Set(staleLemmaStats.map(s => s.normalizedLemma));

  const staleEncounters = await db.encounters
    .where('createdAt')
    .below(cutoff)
    .and(e => staleLemmaSet.has(e.normalizedSurface))
    .toArray();

  let deletedVocabulary = 0;

  if (!dryRun) {
    await db.transaction('rw', db.encounters, db.lemmaStats, db.vocabulary, async () => {
      if (staleEncounters.length) {
        await db.encounters.bulkDelete(staleEncounters.map(e => e.encounterId));
      }
      if (staleLemmaStats.length) {
        await db.lemmaStats.bulkDelete(staleLemmaStats.map(s => s.lemmaStatId));
      }
      const touchedVocabIds = [...new Set(staleEncounters.map(e => e.vocabId))];
      for (const vocabId of touchedVocabIds) {
        const remain = await db.encounters.where('vocabId').equals(vocabId).count();
        if (remain > 0) continue;
        const vocab = await db.vocabulary.get(vocabId);
        if (!vocab) continue;
        if (vocab.isTraced || vocab.scoreLocked || vocab.sourceType === 'manual') continue;
        await db.vocabulary.delete(vocabId);
        deletedVocabulary++;
      }
    });
  }

  return {
    deletedEncounters: staleEncounters.length,
    deletedLemmaStats: staleLemmaStats.length,
    deletedVocabulary: dryRun ? 0 : deletedVocabulary,
    cutoff,
  };
}
