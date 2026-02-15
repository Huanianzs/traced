import { ProviderAdapter, TranslationRequest, TranslationResult, ProviderConfig } from './types';
import { AppError } from '../types/errors';

export class OpenAICompatibleAdapter implements ProviderAdapter {
  private buildEndpointCandidates(baseUrl: string): string[] {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new AppError('VALIDATION_ERROR', 'Invalid provider URL', false);
    }

    const normalized = parsed.toString().replace(/\/+$/, '');
    const hasCompletionPath = /\/chat\/completions(?:\/|$)/.test(parsed.pathname);
    if (hasCompletionPath) return [normalized];

    const candidates: string[] = [];
    const hasV1Path = /\/v1(?:\/|$)/.test(parsed.pathname);

    // Special handling for LongCat API
    const isLongCat = parsed.hostname.includes('longcat.chat');
    if (isLongCat && !parsed.pathname.includes('/openai') && !parsed.pathname.includes('/anthropic')) {
      // LongCat requires /openai/v1/chat/completions or /anthropic/v1/messages
      candidates.push(`${normalized}/openai/v1/chat/completions`);
      candidates.push(`${normalized}/anthropic/v1/messages`);
    }

    if (hasV1Path) {
      candidates.push(`${normalized}/chat/completions`);
      const withoutV1 = normalized.replace(/\/v1(?:\/)?$/, '');
      if (withoutV1) candidates.push(`${withoutV1}/chat/completions`);
    } else {
      candidates.push(`${normalized}/v1/chat/completions`);
      candidates.push(`${normalized}/chat/completions`);
    }

    return [...new Set(candidates)];
  }

  async translate(
    req: TranslationRequest,
    cfg: ProviderConfig,
    systemPrompt: string
  ): Promise<TranslationResult> {
    const endpointCandidates = this.buildEndpointCandidates(cfg.baseUrl);

    // Truncate input to prevent abuse
    const sourceText = req.sourceText.slice(0, 2000);
    const contextSentence = req.contextSentence?.slice(0, 4000);

    const userContent = contextSentence
      ? `Word/Phrase: "${sourceText}"\nContext: "${contextSentence}"`
      : `Word/Phrase: "${sourceText}"`;

    const body = {
      model: cfg.model?.trim() || 'gpt-4o-mini',
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    };

    const endpointErrors: string[] = [];
    for (const endpoint of endpointCandidates) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), cfg.timeoutMs);
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const errText = (await res.text().catch(() => '')).slice(0, 300);
          if (res.status === 401) {
            throw new AppError('AUTH_ERROR', 'Invalid API key', false);
          }
          if (res.status === 429) {
            throw new AppError('RATE_LIMIT_ERROR', 'Rate limit exceeded', true);
          }
          throw new AppError(
            'PROVIDER_ERROR',
            `Provider error (${res.status}). ${errText || 'No details provided.'}`,
            res.status >= 500
          );
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content ?? '';

        return {
          translatedText: content,
          model: data.model ?? cfg.model,
          usage: data.usage ? { totalTokens: data.usage.total_tokens } : undefined,
        };
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof AppError) {
          // For invalid key, fail fast and stop endpoint failover.
          if (err.code === 'AUTH_ERROR') throw err;
          endpointErrors.push(`${endpoint}: ${err.message}`);
          continue;
        }
        if (err instanceof Error && err.name === 'AbortError') {
          endpointErrors.push(`${endpoint}: Request timed out`);
          continue;
        }
        endpointErrors.push(`${endpoint}: Network request failed`);
      }
    }

    throw new AppError(
      'TRANSIENT_NETWORK_ERROR',
      `All endpoint attempts failed. ${endpointErrors.join(' | ')}`.slice(0, 500),
      true
    );
  }
}

export const openaiAdapter = new OpenAICompatibleAdapter();
