import { Envelope, ApiResult, MessageType } from '../types/protocol';
import { normalizeError } from '../types/errors';
import { handleTranslateSelection } from './handlers/translate-selection';
import { handleSaveTrace, handleGetTraces, handleDeleteTrace, handleGetAllVocab, handleTranslateTrace } from './handlers/traces';
import { handleGetSettings, handleUpdateSettings } from './handlers/settings';
import { handleUpsertVocab, handleGetVocabList, handleDeleteVocab, handleCheckVocab, handleMarkMastered, handleRateWord, handleGetHighlightSelection, handleUnlockNoiseWord, handleToggleTraceWord, handleDrawCard, handleGetTracedWords } from './handlers/vocab';
import { handleRecordEncounter, handleGetWordEncounters, handleDeleteEncounter } from './handlers/encounters';
import { handleScanPageWords } from './handlers/scan-page-words';
import {
  handleListWordbanks,
  handleCreateWordbank,
  handleDeleteWordbank,
  handleGetUserWordbanks,
  handleUpsertUserWordbanks,
  handleGetWordbankStats,
  handleImportWordbankWords,
  handleGetWordbankWords
} from './handlers/wordbanks';
import { handleDevDebug } from './handlers/dev-debug';
import { handleBatchTranslateWords } from './handlers/translation-lookup';
import { handleShortcutAction } from './handlers/shortcut-action';
import { handleGetWeeklyHighlights } from './handlers/weekly-highlights';
import { handleCleanupOldEncounters } from './handlers/cleanup-old-encounters';
import { handleGetGiantWordbank, handleDrawTimelineCard } from './handlers/encounters-explorer';

type Handler<T, R> = (payload: T) => Promise<R>;

async function handleOpenSidepanel(): Promise<{ success: true }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
  return { success: true };
}

const handlers: Partial<Record<MessageType, Handler<unknown, unknown>>> = {
  TRANSLATE_SELECTION: handleTranslateSelection,
  SAVE_TRACE: handleSaveTrace,
  GET_TRACES: handleGetTraces,
  DELETE_TRACE: handleDeleteTrace,
  GET_ALL_VOCAB: handleGetAllVocab,
  GET_SETTINGS: handleGetSettings,
  UPDATE_SETTINGS: handleUpdateSettings,
  UPSERT_VOCAB: handleUpsertVocab,
  GET_VOCAB_LIST: handleGetVocabList,
  DELETE_VOCAB: handleDeleteVocab,
  CHECK_VOCAB: handleCheckVocab,
  MARK_MASTERED: handleMarkMastered,
  RATE_WORD: handleRateWord,
  TOGGLE_TRACE_WORD: handleToggleTraceWord,
  GET_HIGHLIGHT_SELECTION: handleGetHighlightSelection,
  RECORD_ENCOUNTER: handleRecordEncounter,
  GET_WORD_ENCOUNTERS: handleGetWordEncounters,
  DELETE_ENCOUNTER: handleDeleteEncounter,
  SCAN_PAGE_WORDS: handleScanPageWords,
  OPEN_SIDEPANEL: handleOpenSidepanel,
  SHORTCUT_ACTION: handleShortcutAction,
  // Wordbank handlers
  LIST_WORDBANKS: handleListWordbanks,
  CREATE_WORDBANK: handleCreateWordbank,
  DELETE_WORDBANK: handleDeleteWordbank,
  GET_USER_WORDBANKS: handleGetUserWordbanks,
  UPSERT_USER_WORDBANKS: handleUpsertUserWordbanks,
  GET_WORDBANK_STATS: handleGetWordbankStats,
  IMPORT_WORDBANK_WORDS: handleImportWordbankWords,
  GET_WORDBANK_WORDS: handleGetWordbankWords,
  UNLOCK_NOISE_WORD: handleUnlockNoiseWord,
  TRANSLATE_TRACE: handleTranslateTrace,
  BATCH_TRANSLATE_WORDS: handleBatchTranslateWords,
  DRAW_CARD: handleDrawCard,
  DRAW_TIMELINE_CARD: handleDrawTimelineCard,
  GET_GIANT_WORDBANK: handleGetGiantWordbank,
  GET_WEEKLY_HIGHLIGHTS: handleGetWeeklyHighlights,
  GET_TRACED_WORDS: handleGetTracedWords,
  CLEANUP_OLD_ENCOUNTERS: handleCleanupOldEncounters,
  DEV_DEBUG: handleDevDebug,
};

export async function routeMessage(envelope: Envelope): Promise<ApiResult<unknown>> {
  const { type, payload, requestId } = envelope;

  // Validate protocol version
  if (envelope.protocolVersion !== '1.0.0') {
    return {
      ok: false,
      requestId,
      error: {
        code: 'VALIDATION_ERROR',
        message: `Unsupported protocol version: ${envelope.protocolVersion}`,
        retryable: false,
      },
    };
  }

  const handler = handlers[type];
  if (!handler) {
    return {
      ok: false,
      requestId,
      error: {
        code: 'VALIDATION_ERROR',
        message: `Unknown message type: ${type}`,
        retryable: false,
      },
    };
  }

  try {
    const data = await handler(payload);
    return { ok: true, requestId, data };
  } catch (err) {
    return { ok: false, requestId, error: normalizeError(err) };
  }
}
