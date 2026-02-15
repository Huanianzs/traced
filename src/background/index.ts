import { Envelope, ApiResult, ShortcutActionPayload } from './types/protocol';
import { routeMessage } from './router/message-router';
import { normalizeError } from './types/errors';
import { db } from './storage/db';
import { initWordbankData, initNoiseWords } from './storage/wordbank-loader';
import { createEnvelope } from './types/protocol';

// Validate message envelope
function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.protocolVersion === 'string' &&
    typeof v.requestId === 'string' &&
    typeof v.type === 'string' &&
    v.target === 'background'
  );
}

// Initialize default settings
async function initDefaults() {
  const defaults: Record<string, unknown> = {
    wordTranslationMode: 1,
    wordTranslationStyle: 'above',
    smartHighlightEnabled: true,
    smartExpansionEnabled: true,
    defaultHighlightMode: 2,
    promotionMinCount: 6,
    promotionMinPages: 3,
    environmentRankThreshold: 2000,
    cleanupAgeDays: 30,
    cleanupMinCount: 3,
    paragraphTranslationEnabled: false,
    paragraphTranslationStyle: 'block',
    translationFontSizeEm: 0.65,
    translationUnderlineStyle: 'dotted',
    translationDotSizePx: 4,
    translationTextColor: '#666666',
    autoTraceEnabled: true,
    autoTracePoolSize: 30,
    noiseWordbankId: '',
    noiseManualAdd: [],
    noiseManualRemove: [],
  };
  const now = Date.now();
  const existing = await db.settings.toArray();
  const existingKeys = new Set(existing.map(s => s.key));
  const toInsert = Object.entries(defaults)
    .filter(([key]) => !existingKeys.has(key))
    .map(([key, value]) => ({ key, value, updatedAt: now }));
  if (toInsert.length) await db.settings.bulkAdd(toInsert);

  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
}

let initPromise: Promise<void> | null = null;
async function ensureInitialized(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await initDefaults();
    await initWordbankData();
    await initNoiseWords();
  })();
  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

// Message listener with validation
chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse: (response: ApiResult<unknown>) => void) => {
    // Only accept messages from this extension
    if (sender.id !== chrome.runtime.id) {
      return false;
    }

    if (!isEnvelope(message)) {
      sendResponse({
        ok: false,
        requestId: 'unknown',
        error: { code: 'VALIDATION_ERROR', message: 'Invalid message envelope', retryable: false },
      });
      return false;
    }

    routeMessage(message)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({
          ok: false,
          requestId: message.requestId,
          error: normalizeError(err),
        });
      });
    return true; // Keep channel open for async response
  }
);

// Commands API listener for keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-word-translation' || command === 'toggle-paragraph-translation') {
    const payload: ShortcutActionPayload = {
      action: command,
      source: 'commands-api'
    };

    const envelope = createEnvelope('SHORTCUT_ACTION', payload, 'background');

    try {
      await routeMessage(envelope);
    } catch (err) {
      console.error('[Traced] Command handler error:', err);
    }
  }
});

// Initialize on install/startup
chrome.runtime.onInstalled.addListener(async () => {
  await ensureInitialized();
  console.log('[Traced] Extension installed');
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureInitialized();
  console.log('[Traced] Extension started');
});

ensureInitialized().catch((err) => {
  console.error('[Traced] Init on load failed:', err);
});

console.log('[Traced] Background service worker loaded');
