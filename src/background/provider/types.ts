export interface TranslationRequest {
  sourceText: string;
  targetLang: string;
  mode: 'default' | 'poetry' | 'webnovel' | 'paragraph' | 'word-only';
  contextSentence?: string;
}

export interface TranslationResult {
  translatedText: string;
  model: string;
  usage?: { totalTokens?: number };
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
}

export interface ProviderAdapter {
  translate(req: TranslationRequest, cfg: ProviderConfig, systemPrompt: string): Promise<TranslationResult>;
}
