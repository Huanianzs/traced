import { db, ProviderEntity, PromptTemplate } from '../../storage/db';
import { syncNoiseWordsFromSettings } from '../../storage/wordbank-loader';
import { GetSettingsResult, UpdateSettingsPayload } from '../../types/protocol';

function pref<T>(prefs: Record<string, unknown>, key: string, fallback: T): T {
  const v = prefs[key];
  return (v !== undefined && v !== null ? v : fallback) as T;
}

export async function handleGetSettings(): Promise<GetSettingsResult> {
  const providers = await db.providers.toArray();
  const prompts = await db.prompts.toArray();
  const settingsKV = await db.settings.toArray();

  const preferences: Record<string, unknown> = {};
  for (const kv of settingsKV) preferences[kv.key] = kv.value;

  return {
    providers,
    prompts,
    preferences,
    runtime: {
      lastUsedProviderId: pref<string | undefined>(preferences, 'runtime.lastUsedProviderId', undefined),
      lastUsedProviderName: pref<string | undefined>(preferences, 'runtime.lastUsedProviderName', undefined),
      lastUsedModel: pref<string | undefined>(preferences, 'runtime.lastUsedModel', undefined),
      lastUsedAt: pref<number | undefined>(preferences, 'runtime.lastUsedAt', undefined),
      providerStatus: Object.fromEntries(
        Object.entries(preferences)
          .filter(([k]) => k.startsWith('runtime.providerStatus.'))
          .map(([k, v]) => [k.replace('runtime.providerStatus.', ''), (v ?? {}) as Record<string, unknown>])
      ) as Record<string, { lastSuccessAt?: number; lastErrorAt?: number; lastError?: string; lastLatencyMs?: number }>,
    },
    smartHighlightEnabled: pref(preferences, 'smartHighlightEnabled', true),
    smartExpansionEnabled: pref(preferences, 'smartExpansionEnabled', true),
    autoTraceEnabled: pref(preferences, 'autoTraceEnabled', true),
    autoTracePoolSize: pref(preferences, 'autoTracePoolSize', 30),
    wordTranslationMode: pref(preferences, 'wordTranslationMode', 1),
    wordTranslationStyle: pref(preferences, 'wordTranslationStyle', 'above'),
    paragraphTranslationEnabled: pref(preferences, 'paragraphTranslationEnabled', false),
    paragraphTranslationStyle: pref(preferences, 'paragraphTranslationStyle', 'block'),
    translationFontSizeEm: pref(preferences, 'translationFontSizeEm', 0.65),
    translationUnderlineStyle: pref(preferences, 'translationUnderlineStyle', 'dotted'),
    translationDotSizePx: pref(preferences, 'translationDotSizePx', 4),
    translationTextColor: pref(preferences, 'translationTextColor', '#666666'),
  };
}

export async function handleUpdateSettings(payload: unknown): Promise<{ success: true }> {
  const data = payload as UpdateSettingsPayload;
  const now = Date.now();

  if (data.provider) {
    const { providerId, ...updates } = data.provider;
    await db.transaction('rw', db.providers, async () => {
      const existing = await db.providers.get(providerId);
      const defaultEnabled = existing?.enabled ?? true;
      const nextEnabled = updates.enabled ?? defaultEnabled;

      if (existing) {
        await db.providers.update(providerId, { ...updates, updatedAt: now });
      } else {
        const maxPriority = (await db.providers.toArray()).reduce((m, p) => Math.max(m, p.priority ?? 0), 0);
        await db.providers.add({
          providerId,
          name: updates.name ?? 'User Provider',
          baseUrl: updates.baseUrl ?? '',
          apiKey: updates.apiKey ?? '',
          defaultModel: updates.defaultModel ?? '',
          timeoutMs: updates.timeoutMs ?? 30000,
          maxTokens: updates.maxTokens ?? 1000,
          temperature: updates.temperature ?? 0.7,
          enabled: updates.enabled ?? true,
          available: updates.available ?? true,
          priority: updates.priority ?? (maxPriority + 1),
          deletedAt: updates.deletedAt,
          updatedAt: now,
          ...updates,
        } as ProviderEntity);
      }

      if (nextEnabled) {
        await db.providers
          .filter(p => p.providerId !== providerId && p.enabled)
          .modify({ enabled: false, updatedAt: now });
      }
    });
  }

  if (data.prompt) {
    const { templateId, ...updates } = data.prompt;
    const existing = await db.prompts.get(templateId);
    if (existing) {
      await db.prompts.update(templateId, { ...updates, updatedAt: now });
    } else {
      await db.prompts.add({
        templateId,
        mode: 'default',
        name: 'New Template',
        systemPrompt: '',
        enabled: true,
        builtIn: false,
        updatedAt: now,
        ...updates,
      } as PromptTemplate);
    }
  }

  if (data.preference) {
    const { key, value } = data.preference;
    await db.settings.put({ key, value, updatedAt: now });
  }

  // Handle bulk preferences update
  if (data.preferences) {
    let shouldSyncNoise = false;
    for (const [key, value] of Object.entries(data.preferences)) {
      await db.settings.put({ key, value, updatedAt: now });
      if (key === 'noiseWordbankId' || key === 'noiseManualAdd' || key === 'noiseManualRemove') {
        shouldSyncNoise = true;
      }
    }
    if (shouldSyncNoise) {
      await syncNoiseWordsFromSettings(true);
    }
  }

  // Handle smartHighlightEnabled directly
  if (typeof data.smartHighlightEnabled === 'boolean') {
    await db.settings.put({ key: 'smartHighlightEnabled', value: data.smartHighlightEnabled, updatedAt: now });
  }

  if (typeof data.smartExpansionEnabled === 'boolean') {
    await db.settings.put({ key: 'smartExpansionEnabled', value: data.smartExpansionEnabled, updatedAt: now });
  }

  if (typeof data.autoTraceEnabled === 'boolean') {
    await db.settings.put({ key: 'autoTraceEnabled', value: data.autoTraceEnabled, updatedAt: now });
  }

  if (typeof data.autoTracePoolSize === 'number') {
    const clamped = Math.max(0, Math.min(500, Math.floor(data.autoTracePoolSize)));
    await db.settings.put({ key: 'autoTracePoolSize', value: clamped, updatedAt: now });
  }

  return { success: true };
}
