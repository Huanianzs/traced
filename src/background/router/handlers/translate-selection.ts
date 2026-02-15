import { openaiAdapter } from '../../provider/openai-compatible';
import { getSystemPrompt } from '../../provider/prompts';
import { TranslationRequest, ProviderConfig } from '../../provider/types';
import { db } from '../../storage/db';
import { AppError } from '../../types/errors';
import { TranslateSelectionPayload, TranslateSelectionResult } from '../../types/protocol';

export async function handleTranslateSelection(payload: unknown): Promise<TranslateSelectionResult> {
  const { sourceText, contextSentence, mode = 'default' } = payload as TranslateSelectionPayload;

  if (!sourceText?.trim()) {
    throw new AppError('VALIDATION_ERROR', 'sourceText is required', false);
  }

  // Get user-configured providers (enabled first, then recently updated).
  const allProviders = await db.providers.toArray();
  const providerCandidates = allProviders
    .filter(p => !p.deletedAt && p.available !== false && p.baseUrl?.trim() && p.apiKey?.trim())
    .sort((a, b) => {
      const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
      const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });

  if (providerCandidates.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'No provider configured. Please add an API provider in settings.', false);
  }

  const req: TranslationRequest = {
    sourceText: sourceText.trim(),
    targetLang: 'zh-CN',
    mode,
    contextSentence,
  };

  const systemPrompt = getSystemPrompt(mode);
  const failoverErrors: string[] = [];

  for (const provider of providerCandidates) {
    const config: ProviderConfig = {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.defaultModel,
      timeoutMs: provider.timeoutMs ?? 30000,
      maxTokens: provider.maxTokens ?? 1000,
      temperature: provider.temperature ?? 0.7,
    };

    try {
      const startedAt = Date.now();
      const result = await openaiAdapter.translate(req, config, systemPrompt);
      const now = Date.now();
      const latencyMs = now - startedAt;
      await db.settings.bulkPut([
        { key: 'runtime.lastUsedProviderId', value: provider.providerId, updatedAt: now },
        { key: 'runtime.lastUsedProviderName', value: provider.name, updatedAt: now },
        { key: 'runtime.lastUsedModel', value: result.model || config.model, updatedAt: now },
        { key: 'runtime.lastUsedAt', value: now, updatedAt: now },
        {
          key: `runtime.providerStatus.${provider.providerId}`,
          value: { lastSuccessAt: now, lastLatencyMs: latencyMs, lastError: '' },
          updatedAt: now
        },
      ]);
      return {
        translatedText: result.translatedText,
        mode,
        model: result.model,
      };
    } catch (err) {
      const now = Date.now();
      const message = err instanceof Error ? err.message : String(err);
      await db.settings.put({
        key: `runtime.providerStatus.${provider.providerId}`,
        value: { lastErrorAt: now, lastError: message.slice(0, 300) },
        updatedAt: now
      });
      failoverErrors.push(`${provider.name || provider.providerId}: ${message}`);
      continue;
    }
  }

  throw new AppError(
    'PROVIDER_ERROR',
    `All configured providers failed. ${failoverErrors.join(' | ')}`.slice(0, 600),
    true
  );
}
