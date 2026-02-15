import { db } from '../../storage/db';
import { ShortcutActionPayload } from '../../types/protocol';

export async function handleShortcutAction(payload: unknown): Promise<{ success: true }> {
  const { action } = payload as ShortcutActionPayload;

  const settingsKV = await db.settings.toArray();
  const prefs: Record<string, unknown> = {};
  for (const kv of settingsKV) prefs[kv.key] = kv.value;

  const now = Date.now();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (action === 'toggle-word-translation') {
    const current = typeof prefs.wordTranslationMode === 'number' ? prefs.wordTranslationMode as number : 1;
    const next = (current + 1) % 3;
    await db.settings.bulkPut([
      { key: 'wordTranslationMode', value: next, updatedAt: now },
    ]);
    if (tab?.id) {
      try { await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_TRANSLATION', mode: next }); }
      catch (err) { console.warn('[Traced] Cannot relay to content script:', err); }
    }
  } else {
    const current = typeof prefs.paragraphTranslationEnabled === 'boolean' ? prefs.paragraphTranslationEnabled : false;
    const next = !current;
    await db.settings.put({ key: 'paragraphTranslationEnabled', value: next, updatedAt: now });
    if (tab?.id) {
      try { await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PARAGRAPH_TRANSLATION', visible: next }); }
      catch (err) { console.warn('[Traced] Cannot relay to content script:', err); }
    }
  }

  return { success: true };
}
