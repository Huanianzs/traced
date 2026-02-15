import { db, WordbankWordEntity, VocabEntity } from './db';
import { normalizeLemma } from '../../lib/domain-utils';
import { BUILTIN_WORDBANKS } from '../../lib/constants';
import cet4Data from '../data/cet4.json';
import cet6Data from '../data/cet6.json';
import gaokaoData from '../data/gaokao.json';
import postgradData from '../data/postgrad.json';
import primaryData from '../data/primary.json';
import programmingData from '../data/programming.json';
import noiseRawData from '../data/noise-words.json';
import top10kData from '../data/top10k.json';

interface WordData {
  lemma: string;
  surface: string;
  meaning?: string;
  rank: number;
}

const noiseData: WordData[] = (noiseRawData as Array<{ lemma: string; surface: string }>).map((w, i) => ({ ...w, rank: i + 1 }));
const dailyData: WordData[] = (top10kData as WordData[]).filter(w => typeof w.rank === 'number' && w.rank <= 3000);

const WORDBANK_DATA: Record<string, WordData[]> = {
  wb_noise: noiseData,
  wb_daily: dailyData,
  wb_programming: programmingData as WordData[],
  wb_cet4: cet4Data as WordData[],
  wb_cet6: cet6Data as WordData[],
  wb_gaokao: gaokaoData as WordData[],
  wb_primary: primaryData as WordData[],
  wb_postgrad: postgradData as WordData[],
  wb_top10k: top10kData as WordData[],
};

export async function initWordbankData(): Promise<void> {
  console.log('[Traced] Starting wordbank data initialization...');

  await db.open();

  // Remove deprecated topup wordbank data for existing users.
  await db.transaction('rw', db.wordbanks, db.wordbankWords, db.userWordbanks, async () => {
    await db.wordbankWords.where('wordbankId').equals('wb_topup').delete();
    await db.userWordbanks.where('wordbankId').equals('wb_topup').delete();
    await db.wordbanks.where('wordbankId').equals('wb_topup').delete();
  });

  // Ensure built-in wordbanks exist for existing users on old DB versions.
  const now = Date.now();
  for (const wb of BUILTIN_WORDBANKS) {
    const existing = await db.wordbanks.get(wb.wordbankId);
    if (!existing) {
      await db.wordbanks.add({
        wordbankId: wb.wordbankId,
        code: wb.code,
        name: wb.name,
        language: 'en',
        builtIn: true,
        enabledByDefault: false,
        version: '1.0.0',
        wordCount: 0,
        createdAt: now,
        updatedAt: now
      });
    } else if (existing.deletedAt) {
      await db.wordbanks.update(wb.wordbankId, { deletedAt: undefined, builtIn: true, updatedAt: now });
    }

    const userWb = await db.userWordbanks.where('wordbankId').equals(wb.wordbankId).first();
    if (!userWb) {
      await db.userWordbanks.add({
        userWordbankId: crypto.randomUUID(),
        wordbankId: wb.wordbankId,
        enabled: false,
        createdAt: now,
        updatedAt: now
      });
    }
  }

  for (const [wordbankId, words] of Object.entries(WORDBANK_DATA)) {
    const wordbank = await db.wordbanks.get(wordbankId);
    console.log(`[Traced] Checking ${wordbankId}:`, wordbank ? `wordCount=${wordbank.wordCount}` : 'not found');

    if (!wordbank) {
      console.log(`[Traced] Wordbank ${wordbankId} not found, skipping`);
      continue;
    }

    const needsReload = wordbank.wordCount !== words.length;
    if (!needsReload) {
      console.log(`[Traced] Wordbank ${wordbankId} already has ${wordbank.wordCount} words (up-to-date), skipping`);
      continue;
    }

    try {
      console.log(`[Traced] Loading ${words.length} words for ${wordbankId} (prev=${wordbank.wordCount})...`);
      const now = Date.now();

      const entities: WordbankWordEntity[] = words.map((w, i) => ({
        wordId: `${wordbankId}_${i}`,
        wordbankId,
        lemma: normalizeLemma(w.lemma),
        surface: w.surface,
        normalized: normalizeLemma(w.lemma),
        language: 'en',
        rank: w.rank,
        createdAt: now
      }));

      await db.wordbankWords.where('wordbankId').equals(wordbankId).delete();
      await db.wordbankWords.bulkPut(entities);
      await db.wordbanks.update(wordbankId, { wordCount: entities.length, updatedAt: now });

      console.log(`[Traced] Successfully loaded ${entities.length} words for ${wordbankId}`);
    } catch (err) {
      console.error(`[Traced] Failed to load ${wordbankId}:`, err);
    }
  }

  console.log('[Traced] Wordbank data initialization complete');
}

export async function initNoiseWords(): Promise<void> {
  // Initialize configurable noise-word settings.
  const now = Date.now();
  const hasNoiseSource = await db.settings.get('noiseWordbankId');
  const hasManualAdd = await db.settings.get('noiseManualAdd');
  const hasManualRemove = await db.settings.get('noiseManualRemove');
  if (!hasNoiseSource) {
    await db.settings.put({ key: 'noiseWordbankId', value: '', updatedAt: now });
  }
  if (!hasManualAdd) {
    await db.settings.put({ key: 'noiseManualAdd', value: [], updatedAt: now });
  }
  if (!hasManualRemove) {
    await db.settings.put({ key: 'noiseManualRemove', value: [], updatedAt: now });
  }

  await syncNoiseWordsFromSettings(true);
}

function toLemmaSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value
    .map(v => normalizeLemma(String(v ?? '')))
    .filter(Boolean));
}

export async function syncNoiseWordsFromSettings(force = false): Promise<void> {
  const source = (await db.settings.get('noiseWordbankId'))?.value;
  const sourceWordbankId = typeof source === 'string' ? source : '';
  const manualAdd = toLemmaSet((await db.settings.get('noiseManualAdd'))?.value);
  const manualRemove = toLemmaSet((await db.settings.get('noiseManualRemove'))?.value);

  const cfgKey = JSON.stringify({
    sourceWordbankId,
    add: Array.from(manualAdd).sort(),
    remove: Array.from(manualRemove).sort(),
  });
  const prevCfg = (await db.settings.get('noiseConfigHash'))?.value;
  if (!force && prevCfg === cfgKey) return;

  const target = new Set<string>();
  if (sourceWordbankId) {
    const words = await db.wordbankWords.where('wordbankId').equals(sourceWordbankId).toArray();
    for (const w of words) target.add(normalizeLemma(w.lemma));
  }
  for (const l of manualAdd) target.add(l);
  for (const l of manualRemove) target.delete(l);

  const now = Date.now();
  const managedLocked = await db.vocabulary
    .filter(v => v.scoreLocked === true && v.noiseManaged === true)
    .toArray();
  for (const v of managedLocked) {
    if (!target.has(v.lemma) || v.isTraced) {
      await db.vocabulary.update(v.vocabId, {
        scoreLocked: false,
        familiarityScore: v.isTraced ? (v.familiarityScore ?? 0) : 0,
        isKnown: false,
        noiseManaged: false,
        updatedAt: now
      });
    }
  }

  for (const lemma of target) {
    const existing = await db.vocabulary.where('[lemma+language]').equals([lemma, 'en']).first();
    if (existing) {
      if (existing.isTraced) continue;
      await db.vocabulary.update(existing.vocabId, {
        scoreLocked: true,
        familiarityScore: 100,
        isKnown: true,
        noiseManaged: true,
        updatedAt: now
      });
    } else {
      await db.vocabulary.add({
        vocabId: crypto.randomUUID(),
        lemma,
        surface: lemma,
        language: 'en',
        meaning: '',
        proficiency: 0,
        familiarityScore: 100,
        isKnown: true,
        scoreLocked: true,
        noiseManaged: true,
        createdAt: now,
        updatedAt: now
      } as VocabEntity);
    }
  }

  await db.settings.put({ key: 'noiseConfigHash', value: cfgKey, updatedAt: now });
  console.log(`[Traced] Noise words synced: source=${sourceWordbankId || 'none'}, total=${target.size}`);
}
