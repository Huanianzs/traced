import { db } from '../../storage/db';
import { normalizeLemma } from '../../../lib/domain-utils';
import { extractTranslationLine } from '../../../lib/translation-utils';
import { dictionaryService } from '../../storage/dictionary';
import { BatchTranslateWordsPayload, BatchTranslateWordsResult } from '../../types/protocol';

export async function handleBatchTranslateWords(payload: unknown): Promise<BatchTranslateWordsResult> {
  const data = (payload ?? {}) as BatchTranslateWordsPayload;
  const words = Array.isArray(data.words) ? data.words : [];
  const mode = data.mode ?? 'smart';

  if (mode !== 'api') {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await dictionaryService.ensureLoaded();
        break;
      } catch {
        if (attempt === 0) await new Promise(r => setTimeout(r, 200));
      }
    }
  }

  const translations: BatchTranslateWordsResult['translations'] = {};

  for (const item of words) {
    if (!item?.lemma) continue;
    const lemma = normalizeLemma(item.lemma);
    if (!lemma) continue;

    if (mode === 'api') {
      translations[lemma] = { meaning: '', source: 'api' };
      continue;
    }

    // 对于traced单词，优先查trace记录
    if (item.vocabId) {
      const vocab = await db.vocabulary.get(item.vocabId);
      if (vocab?.isTraced && vocab.sourceTraceId) {
        const trace = await db.traces.get(vocab.sourceTraceId);
        if (trace?.translatedText?.trim()) {
          translations[lemma] = { meaning: extractTranslationLine(trace.translatedText, 'default'), source: 'trace' };
          continue;
        }
      }
      // sourceTraceId 没有的情况，用 sourceText 匹配（尝试精确和 normalized）
      if (vocab?.isTraced) {
        const trace = await db.traces
          .where('sourceText').equalsIgnoreCase(lemma)
          .first()
          ?? await db.traces.filter(t => normalizeLemma(t.sourceText) === lemma).first();
        if (trace?.translatedText?.trim()) {
          if (!vocab.sourceTraceId) {
            db.vocabulary.update(vocab.vocabId, { sourceTraceId: trace.traceId }).catch(() => {});
          }
          translations[lemma] = { meaning: extractTranslationLine(trace.translatedText, 'default'), source: 'trace' };
          continue;
        }
      }
      // vocab 自身存的 meaning
      if (vocab?.meaning?.trim()) {
        translations[lemma] = { meaning: vocab.meaning, source: 'vocab' };
        continue;
      }
    }

    // 查字典
    const dictMeaning = dictionaryService.lookupMeaning(lemma);
    if (dictMeaning) {
      translations[lemma] = { meaning: dictMeaning, source: 'dictionary' };
    } else {
      translations[lemma] = { meaning: '', source: 'api' };
    }
  }

  return { translations };
}
