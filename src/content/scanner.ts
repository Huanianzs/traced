import { sendMessage } from '../lib/messaging';
import { ScanPageWordsPayload, ScanPageWordsResult, ScanPageWordsResultItem, ScanPageWordsStats, VocabItem, BatchTranslateWordsPayload, BatchTranslateWordsResult, createEnvelope } from '../background/types/protocol';

type WordTranslationMode = 0 | 1 | 2;
type WordTranslationStyle = 'above' | 'left';
type ParagraphTranslationStyle = 'sentence' | 'block';

interface ScannerSettings {
  smartHighlightEnabled?: boolean;
  paragraphTranslationEnabled?: boolean;
  wordTranslationMode?: WordTranslationMode;
  wordTranslationStyle?: WordTranslationStyle;
  paragraphTranslationStyle?: ParagraphTranslationStyle;
  translationFontSizeEm?: number;
  translationUnderlineStyle?: 'dotted' | 'dashed' | 'solid' | 'none';
  translationDotSizePx?: number;
  translationTextColor?: string;
}

const EXCLUDED_TAGS = new Set(['script', 'style', 'noscript', 'textarea', 'input', 'select', 'button', 'code', 'pre', 'ruby']);

export class TextScanner {
  private vocab: ScanPageWordsResultItem[] = [];
  private highlightedVocab: VocabItem[] = [];
  private sidebarVocab: VocabItem[] = [];
  private foundVocabIds: Set<string> = new Set();
  private isScanning = false;
  private observer: MutationObserver | null = null;
  private scanTimeout: number | undefined;
  private pendingMutationRoots: Node[] = [];
  private suppressMutations = false;
  private enabled = true;
  private settings: ScannerSettings = {};
  private translations: Map<string, string> = new Map();
  private wordTranslationMode: WordTranslationMode = 1;
  private wordTranslationStyle: WordTranslationStyle = 'above';
  private paragraphTranslationVisible = false;
  private paragraphTranslationStyle: ParagraphTranslationStyle = 'block';
  private paragraphCache: Map<string, string> = new Map();
  private paragraphObserver: IntersectionObserver | null = null;
  private translatingParagraphs: Set<string> = new Set();
  private paragraphQueue: Array<{ el: HTMLElement; id: string }> = [];
  private activeParagraphTranslations = 0;
  private readonly MAX_CONCURRENT_TRANSLATIONS = 3;
  private pageStats: ScanPageWordsStats = { coverage: 0, mastered: 0, topMissedWords: [] };

  private reselectionSeq = 0;
  private reselectDebounce: number | undefined;
  private debugMode = false;
  private debugStats = { dictCount: 0, traceCount: 0, apiCount: 0, fetchError: '' };

  constructor() {
    this.init();
    this.injectStyles();
    this.setupMessageListener();
    this.setupKeyboardListener();
    this.setupTracedWordListener();
    this.setupVisibilitySync();
  }

  private setupVisibilitySync() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      sendMessage<unknown, {
        wordTranslationMode?: WordTranslationMode;
        paragraphTranslationEnabled?: boolean;
        preferences?: Record<string, unknown>;
      }>('GET_SETTINGS', {}).then((res) => {
        const prefs = res.preferences || {};
        const rawMode = res.wordTranslationMode ?? prefs.wordTranslationMode;
        const mode: WordTranslationMode =
          rawMode === 0 || rawMode === 1 || rawMode === 2 ? rawMode as WordTranslationMode : 1;
        if (mode !== this.wordTranslationMode) this.setWordTranslationMode(mode);

        const debugMode = prefs.debugMode === true;
        if (debugMode !== this.debugMode) {
          this.debugMode = debugMode;
          if (debugMode) this.updateDebugOverlay();
          else this.removeDebugOverlay();
        }

        const paraEnabled = (res.paragraphTranslationEnabled ?? prefs.paragraphTranslationEnabled) === true;
        if (paraEnabled !== this.paragraphTranslationVisible) this.toggleParagraphTranslation(paraEnabled);
      }).catch(() => {});
    });
  }

  private setupTracedWordListener() {
    document.addEventListener('traced-word-update', (e: Event) => {
      const { word, vocabId, traced } = (e as CustomEvent).detail;
      if (!word || !vocabId) return;

      // Update or insert vocab entry
      const entry = this.vocab.find(v => v.vocabId === vocabId);
      if (entry) {
        (entry as any).isTraced = traced;
      } else if (traced) {
        // New word not yet in vocab — add minimal entry
        const lemma = word.toLowerCase();
        this.vocab.push({
          vocabId, lemma, surface: word, proficiency: 0,
          encounterCount: 1, weightedScore: 1, presentCount: 1,
          isTraced: true, isKnown: false,
        });
      }

      if (traced) {
        this.rebuildHighlightedVocab();
        // Fetch translation for the newly traced word before scanning
        const lemma = (entry?.lemma || word).toLowerCase();
        sendMessage<BatchTranslateWordsPayload, BatchTranslateWordsResult>('BATCH_TRANSLATE_WORDS', {
          words: [{ lemma, vocabId }], mode: 'smart'
        }).then(result => {
          for (const [key, data] of Object.entries(result.translations)) {
            if (data.meaning) this.translations.set(key.toLowerCase(), data.meaning);
          }
          if (this.enabled) this.runWithMutationSuppressed(() => this.scan());
        }).catch(() => {
          if (this.enabled) this.runWithMutationSuppressed(() => this.scan());
        });
      } else if (this.wordTranslationMode !== 2) {
        // Un-trace in mode 0/1: remove highlights for this word
        this.runWithMutationSuppressed(() => {
          document.querySelectorAll(`.traced-highlight[data-vocab-id="${vocabId}"]`).forEach(el => {
            const surface = (el as HTMLElement).dataset.surface || el.textContent || '';
            const text = document.createTextNode(surface);
            el.parentNode?.replaceChild(text, el);
            text.parentNode?.normalize();
          });
        });
        this.foundVocabIds.delete(vocabId);
        this.rebuildHighlightedVocab();
      }
    });
  }

  private setupKeyboardListener() {
    window.addEventListener('keydown', (e) => {
      const isAltW = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'w';
      const isAltQ = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'q';

      if (!isAltW && !isAltQ) return;

      // Safety check: do not intercept in editable elements
      const target = e.target as HTMLElement;
      if (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA') {
        return;
      }

      e.preventDefault();
      e.stopImmediatePropagation();

      // If text is selected, operate only on the selection
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
        if (isAltW) {
          this.scanSelection(sel);
        } else {
          this.translateSelection(sel);
        }
        return;
      }

      // No selection: global toggle via background
      chrome.runtime.sendMessage(createEnvelope('SHORTCUT_ACTION', {
        action: isAltW ? 'toggle-word-translation' : 'toggle-paragraph-translation',
        source: 'content-enforced',
        pageUrl: location.href
      }));
    }, true); // capture phase
  }

  /** Ctrl+T with selection: highlight/translate words within the selected range */
  private scanSelection(sel: Selection) {
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const root = container.nodeType === Node.TEXT_NODE ? container.parentElement! : container as HTMLElement;

    // Collect text nodes within the selection range
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!sel.containsNode(node, true)) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (EXCLUDED_TAGS.has(parent.tagName.toLowerCase())) return NodeFilter.FILTER_REJECT;
        if (parent.classList.contains('traced-highlight')) return NodeFilter.FILTER_REJECT;
        if (parent.closest('.traced-highlight')) return NodeFilter.FILTER_REJECT;
        if (parent.closest('.trc-para-trans')) return NodeFilter.FILTER_REJECT;
        if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while (node = walker.nextNode()) textNodes.push(node as Text);
    if (!textNodes.length) return;

    // Use all vocab pattern (broadest match) for selection scan
    const pattern = this.buildAllVocabPattern();
    const map = this.buildAllVocabMap();
    if (!pattern) return;

    this.runWithMutationSuppressed(() => {
      this.highlightTextNodes(textNodes, pattern, map);
    });
  }

  /** Alt+T with selection: translate the selected text as a paragraph */
  private async translateSelection(sel: Selection) {
    const text = sel.toString().trim();
    if (!text || text.length < 2) return;

    // Find the closest block element containing the selection
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const el = container.nodeType === Node.TEXT_NODE ? container.parentElement! : container as HTMLElement;
    const blockEl = el.closest('p, div, blockquote, li, td, article, section') as HTMLElement || el;

    const id = `sel-${text.slice(0, 30).replace(/\W/g, '')}-${text.length}`;

    // Toggle off if already showing
    const existing = blockEl.nextElementSibling as HTMLElement | null;
    if (existing?.classList.contains('trc-para-trans') && existing.dataset.trcFor === id) {
      existing.remove();
      return;
    }

    // Use cache if available
    if (this.paragraphCache.has(id)) {
      this.showParagraphTranslation(blockEl, id, this.paragraphCache.get(id)!);
      return;
    }

    // Translate the selected text
    try {
      const result = await sendMessage<{ sourceText: string; mode?: string }, { translatedText: string }>(
        'TRANSLATE_SELECTION', { sourceText: text, mode: 'paragraph' }
      );
      if (result.translatedText) {
        this.paragraphCache.set(id, result.translatedText);
        this.showParagraphTranslation(blockEl, id, result.translatedText);
      }
    } catch (err) {
      console.warn('Selection translation failed:', err);
    }
  }

  private setWordTranslationMode(mode?: WordTranslationMode) {
    const prev = this.wordTranslationMode;
    this.wordTranslationMode = typeof mode === 'number' ? mode : ((prev + 1) % 3) as WordTranslationMode;

    // 高亮始终只针对 traced 单词，不需要根据 mode 重建
    // 只需要控制翻译的显示/隐藏
    if (this.wordTranslationMode === 2 && prev !== 2) {
      // 切换到 mode 2：需要重新扫描以包含所有词库单词的翻译
      this.runWithMutationSuppressed(() => this.removeHighlights());
      this.rebuildHighlightedVocab();
      this.enabled = true;
      if (this.vocab.length > 0) this.runWithMutationSuppressed(() => this.scan());
    } else if (prev === 2 && this.wordTranslationMode !== 2) {
      // 从 mode 2 切换回：需要移除非 traced 单词的翻译
      this.runWithMutationSuppressed(() => this.removeHighlights());
      this.rebuildHighlightedVocab();
      this.enabled = true;
      if (this.highlightedVocab.length > 0) this.runWithMutationSuppressed(() => this.scan());
    } else {
      // mode 0 ↔ mode 1：只需要 CSS 控制翻译显示/隐藏
      this.applyTranslationVisibility();
    }
  }

  private applyTranslationVisibility() {
    document.querySelectorAll('.traced-highlight').forEach(el => {
      const isTraced = el.classList.contains('traced-trace');
      const hide = this.wordTranslationMode === 0 || (this.wordTranslationMode === 1 && !isTraced);
      el.classList.toggle('trc-hidden', hide);
    });
  }

  private rebuildHighlightedVocab() {
    // 高亮只针对 traced 单词，但排除已完全掌握的（isKnown 或 weightedScore >= 100）
    // 重要：traced 单词不受噪声词影响，始终优先显示
    this.highlightedVocab = (this.vocab as VocabItem[]).filter(v => v.isTraced && !v.isKnown && (v.weightedScore ?? 0) <= 100);
  }

  private applyStyleSettings() {
    const s = this.settings;
    const root = document.documentElement;
    root.style.setProperty('--trc-rt-size', `${Math.max(0.45, Math.min(s.translationFontSizeEm ?? 0.65, 1.2))}em`);
    root.style.setProperty('--trc-dot-size', `${Math.max(2, Math.min(s.translationDotSizePx ?? 4, 10))}px`);
    root.style.setProperty('--trc-ul-style', s.translationUnderlineStyle ?? 'dotted');
    root.style.setProperty('--trc-rt-color', s.translationTextColor ?? '#666666');
    this.wordTranslationStyle = s.wordTranslationStyle === 'left' ? 'left' : 'above';
    this.paragraphTranslationStyle = s.paragraphTranslationStyle === 'sentence' ? 'sentence' : 'block';
  }

  private toggleParagraphTranslation(visible?: boolean) {
    this.paragraphTranslationVisible = visible ?? !this.paragraphTranslationVisible;
    if (this.paragraphTranslationVisible) {
      this.setupParagraphObserver();
      this.scanParagraphs();
    } else {
      this.removeParagraphTranslations();
      this.paragraphObserver?.disconnect();
      this.paragraphObserver = null;
    }
  }

  private setupParagraphObserver() {
    if (this.paragraphObserver) return;
    this.paragraphObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLElement;
          const id = el.dataset.trcPid;
          if (id && !this.paragraphCache.has(id) && !this.translatingParagraphs.has(id)) {
            this.queueParagraphTranslation(el, id);
          }
        }
      }
    }, { rootMargin: '500px' });
  }

  private isCJKDominant(text: string): boolean {
    // CJK Unified Ideographs + CJK Extension A/B + CJK Compatibility
    let cjk = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0)!;
      if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF) || (code >= 0x20000 && code <= 0x2A6DF)) cjk++;
    }
    // 中文字符占非空白字符的 40% 以上视为中文段落
    const nonSpace = text.replace(/\s/g, '').length;
    return nonSpace > 0 && cjk / nonSpace > 0.4;
  }

  private scanParagraphs() {
    // 保守的选择器：只选择真正的段落容器
    const paragraphs = document.querySelectorAll('p, blockquote, article > p, article > div');
    paragraphs.forEach((p, i) => {
      const el = p as HTMLElement;
      if (el.classList.contains('trc-para-trans')) return;
      if (el.dataset.trcPid) return;
      const text = el.textContent?.trim() || '';
      // 段落长度限制：至少 50 字符（避免标题、导航等），最多 2000 字符
      if (text.length < 50 || text.length > 2000) return;
      if (this.isCJKDominant(text)) return;
      const id = `p-${i}-${text.slice(0, 20).replace(/\W/g, '')}`;
      el.dataset.trcPid = id;
      if (this.paragraphCache.has(id)) {
        this.showParagraphTranslation(el, id, this.paragraphCache.get(id)!);
      } else {
        this.paragraphObserver?.observe(el);
      }
    });
  }

  private queueParagraphTranslation(el: HTMLElement, id: string) {
    // Add to queue
    this.paragraphQueue.push({ el, id });
    // Process queue
    this.processTranslationQueue();
  }

  private processTranslationQueue() {
    // Check if we can start more translations
    while (this.activeParagraphTranslations < this.MAX_CONCURRENT_TRANSLATIONS && this.paragraphQueue.length > 0) {
      const item = this.paragraphQueue.shift();
      if (item) {
        this.translateParagraph(item.el, item.id);
      }
    }
  }

  private async batchAiTranslate(words: Array<{ lemma: string; vocabId: string }>) {
    // 限制并发数量，避免API限流
    const BATCH_SIZE = 5;
    const DELAY_MS = 500;

    for (let i = 0; i < words.length; i += BATCH_SIZE) {
      const batch = words.slice(i, i + BATCH_SIZE);

      // 并发翻译一批单词
      const results = await Promise.allSettled(
        batch.map(async ({ lemma }) => {
          try {
            const result = await sendMessage<{ sourceText: string; mode?: string }, { translatedText: string }>(
              'TRANSLATE_SELECTION',
              { sourceText: lemma, mode: 'word-only' }
            );
            if (result.translatedText) {
              return { lemma, translation: result.translatedText };
            }
          } catch (err) {
            console.warn(`AI translation failed for "${lemma}":`, err);
          }
          return null;
        })
      );

      // 批量更新翻译（减少DOM操作）
      const successfulTranslations: Array<{ lemma: string; translation: string }> = [];
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          const { lemma, translation } = result.value;
          this.translations.set(lemma.toLowerCase(), translation);
          successfulTranslations.push({ lemma, translation });
        }
      });

      // 一次性更新所有翻译显示
      if (successfulTranslations.length > 0) {
        this.runWithMutationSuppressed(() => {
          successfulTranslations.forEach(({ lemma, translation }) => {
            this.updateTranslationDisplay(lemma, translation);
          });
        });
      }

      // 延迟，避免API限流
      if (i + BATCH_SIZE < words.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }
  }

  private updateTranslationDisplay(lemma: string, translation: string) {
    const normalizedLemma = lemma.toLowerCase();
    document.querySelectorAll('.traced-highlight').forEach(el => {
      const htmlEl = el as HTMLElement;
      const elLemma = htmlEl.dataset.lemma?.toLowerCase();
      const elSurface = htmlEl.dataset.surface?.toLowerCase();
      if (elLemma !== normalizedLemma && elSurface !== normalizedLemma) return;

      // 更新翻译显示
      if (this.wordTranslationStyle === 'left') {
        const transEl = el.querySelector('.trc-inline-trans');
        if (transEl) {
          transEl.textContent = `(${translation})`;
        } else {
          // 如果没有翻译元素，创建一个
          const inline = document.createElement('span');
          inline.className = 'trc-inline-trans';
          inline.textContent = `(${translation})`;
          el.insertBefore(inline, el.firstChild);
        }
      } else {
        // 'above' 模式使用 ruby 标签，翻译在 rt 元素中
        const rtEl = el.querySelector('rt');
        if (rtEl) {
          rtEl.textContent = translation;
        }
      }
    });
  }

  private async translateParagraph(el: HTMLElement, id: string) {
    const text = el.textContent?.trim();
    if (!text) return;
    this.translatingParagraphs.add(id);
    this.activeParagraphTranslations++;
    try {
      const result = await sendMessage<{ sourceText: string; mode?: string }, { translatedText: string }>('TRANSLATE_SELECTION', { sourceText: text, mode: 'paragraph' });
      if (result.translatedText) {
        this.paragraphCache.set(id, result.translatedText);
        if (this.paragraphTranslationVisible) {
          this.showParagraphTranslation(el, id, result.translatedText);
        }
      }
    } catch (err) {
      console.warn('Paragraph translation failed:', err);
    } finally {
      this.translatingParagraphs.delete(id);
      this.activeParagraphTranslations--;
      // Process next in queue
      this.processTranslationQueue();
    }
  }

  private showParagraphTranslation(el: HTMLElement, id: string, translation: string) {
    if (this.paragraphTranslationStyle === 'sentence') {
      this.showParagraphSentenceTranslation(el, id, translation);
      return;
    }
    this.showParagraphBlockTranslation(el, id, translation);
  }

  private showParagraphBlockTranslation(el: HTMLElement, id: string, translation: string) {
    if (!el.isConnected) return;
    const next = el.nextElementSibling as HTMLElement | null;
    if (next?.classList.contains('trc-para-trans') && next.dataset.trcFor === id) {
      if (next.textContent !== translation) next.textContent = translation;
      return;
    }
    const div = document.createElement('div');
    div.className = 'trc-para-trans';
    div.dataset.trcFor = id;
    div.textContent = translation;
    el.insertAdjacentElement('afterend', div);
  }

  private showParagraphSentenceTranslation(el: HTMLElement, id: string, translation: string) {
    if (!el.isConnected) return;
    const next = el.nextElementSibling as HTMLElement | null;
    const sourceSentences = this.segmentSentences(el.textContent?.trim() || '').filter(Boolean);
    const translatedSentences = this.segmentSentences(translation).filter(Boolean);

    // If we cannot align sentences reliably, fallback to block style to avoid broken UI.
    if (!sourceSentences.length || !translatedSentences.length || Math.abs(sourceSentences.length - translatedSentences.length) > 2) {
      this.showParagraphBlockTranslation(el, id, translation);
      return;
    }

    const container = next?.classList.contains('trc-para-trans') && next.dataset.trcFor === id
      ? next
      : document.createElement('div');

    container.className = 'trc-para-trans trc-para-trans-sentence';
    container.dataset.trcFor = id;
    container.replaceChildren();

    for (let i = 0; i < sourceSentences.length; i++) {
      const row = document.createElement('div');
      row.className = 'trc-para-line';

      const src = document.createElement('div');
      src.className = 'trc-para-src';
      src.textContent = sourceSentences[i];

      const trans = document.createElement('div');
      trans.className = 'trc-para-line-trans';
      trans.textContent = translatedSentences[Math.min(i, translatedSentences.length - 1)] || '';

      row.append(src, trans);
      container.appendChild(row);
    }

    if (container !== next) {
      el.insertAdjacentElement('afterend', container);
    }
  }

  private removeParagraphTranslations() {
    document.querySelectorAll('.trc-para-trans').forEach(el => el.remove());
    document.querySelectorAll('[data-trc-pid]').forEach(el => {
      delete (el as HTMLElement).dataset.trcPid;
    });
  }

  private injectStyles() {
    const styleId = 'traced-highlight-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .traced-highlight {
        cursor: pointer;
        position: relative;
        transition: background-color 0.2s;
      }
      /* 只有 traced 单词才有下划线和点 */
      .traced-highlight.traced-trace {
        border-bottom: 2px var(--trc-ul-style, dotted) var(--trc-ul, rgba(178, 34, 34, 0.4));
      }
      .traced-highlight.traced-trace::after {
        content: '';
        position: absolute;
        top: -2px;
        right: -4px;
        width: var(--trc-dot-size, 4px);
        height: var(--trc-dot-size, 4px);
        border-radius: 50%;
        background-color: var(--trc-dot, #F59E0B);
      }
      .traced-highlight:hover {
        background-color: rgba(178, 34, 34, 0.1);
      }
      .traced-highlight.hidden {
        border-bottom: none !important;
      }
      .traced-highlight.hidden::after {
        display: none;
      }
      .traced-highlight rt {
        font-size: var(--trc-rt-size, 0.65em);
        color: var(--trc-rt-color, #666);
        user-select: none;
      }
      .traced-highlight.trc-left .trc-inline-trans {
        color: var(--trc-rt-color, #666);
        font-size: var(--trc-rt-size, 0.65em);
        margin-right: 0.3em;
        user-select: none;
      }
      .traced-highlight rp {
        display: none;
      }
      .traced-highlight.trc-hidden rt {
        visibility: hidden;
      }
      .traced-highlight.trc-hidden .trc-inline-trans {
        display: none;
      }
      .trc-para-trans {
        margin: 8px 0 16px;
        padding: 8px 12px;
        background: rgba(178, 34, 34, 0.05);
        border-left: 3px solid rgba(178, 34, 34, 0.3);
        color: #555;
        font-size: 0.9em;
        line-height: 1.6;
        border-radius: 0 4px 4px 0;
      }
      .trc-para-trans.trc-para-trans-sentence .trc-para-line + .trc-para-line {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px dashed rgba(178, 34, 34, 0.18);
      }
      .trc-para-trans.trc-para-trans-sentence .trc-para-src {
        color: #333;
        font-size: 0.92em;
      }
      .trc-para-trans.trc-para-trans-sentence .trc-para-line-trans {
        color: #555;
        margin-top: 2px;
      }
      @media (prefers-color-scheme: dark) {
        .trc-para-trans {
          background: rgba(178, 34, 34, 0.1);
          color: #aaa;
        }
        .trc-para-trans.trc-para-trans-sentence .trc-para-src {
          color: #ddd;
        }
        .trc-para-trans.trc-para-trans-sentence .trc-para-line-trans {
          color: #aaa;
        }
      }
    `;
    document.head.appendChild(style);
  }

  private setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'GET_SCANNED_TRACES') {
        sendResponse({ traceIds: Array.from(this.foundVocabIds) });
        return false;
      }

      if (message.type === 'GET_PAGE_TEXT') {
        sendResponse({ textContent: this.getPageText() });
        return false;
      }

      if (message.type === 'TOGGLE_HIGHLIGHT') {
        this.setEnabled(message.enabled);
        sendResponse({ success: true });
        return false;
      }

      if (message.type === 'TOGGLE_TRANSLATION') {
        if (typeof message.mode === 'number') {
          this.setWordTranslationMode(message.mode as WordTranslationMode);
        } else if (typeof message.visible === 'boolean') {
          this.setWordTranslationMode(message.visible ? 1 : 0);
        } else {
          this.setWordTranslationMode();
        }
        sendResponse({ success: true });
        return false;
      }

      if (message.type === 'TOGGLE_PARAGRAPH_TRANSLATION') {
        this.toggleParagraphTranslation(message.visible);
        sendResponse({ success: true });
        return false;
      }

      if (message.type === 'UPDATE_SETTINGS') {
        this.settings = { ...this.settings, ...message.settings };
        if (typeof message.settings?.debugMode === 'boolean') {
          this.debugMode = message.settings.debugMode;
          if (this.debugMode) this.updateDebugOverlay();
          else this.removeDebugOverlay();
        }
        this.applyStyleSettings();
        if (this.paragraphTranslationVisible) {
          this.removeParagraphTranslations();
          this.scanParagraphs();
        }
        clearTimeout(this.reselectDebounce);
        this.reselectDebounce = window.setTimeout(() => {
          this.reselect().catch(() => {});
        }, 150);
        sendResponse({ success: true });
        return false;
      }

      if (message.type === 'GET_SIDEBAR_WORDS') {
        sendResponse({ words: this.sidebarVocab });
        return false;
      }

      if (message.type === 'GET_HIGHLIGHTED_WORDS') {
        sendResponse({ words: this.highlightedVocab });
        return false;
      }

      if (message.type === 'GET_ALL_PAGE_VOCAB') {
        sendResponse({ words: this.vocab });
        return false;
      }

      if (message.type === 'GET_PAGE_STATS') {
        sendResponse({ stats: this.pageStats });
        return false;
      }

      if (message.type === 'REMOVE_PAGE_VOCAB') {
        this.vocab = this.vocab.filter(v => v.vocabId !== message.vocabId);
        this.reselect().catch(() => {});
        sendResponse({ success: true });
        return false;
      }

      if (message.type === 'RESTORE_PAGE_VOCAB') {
        if (message.vocab && !this.vocab.some(v => v.vocabId === message.vocab.vocabId)) {
          this.vocab.unshift(message.vocab);
        }
        this.reselect().catch(() => {});
        sendResponse({ success: true });
        return false;
      }

      if (message.type === 'RESELECT_HIGHLIGHTS') {
        this.reselect().catch(() => {});
        sendResponse({ success: true });
        return false;
      }

      if (message.type === 'TRACED_WORD_UPDATE') {
        const { word, vocabId, traced } = message;
        const entry = this.vocab.find(v => v.vocabId === vocabId || v.surface.toLowerCase() === word?.toLowerCase());
        if (entry) (entry as any).isTraced = traced;
        if (!traced && this.wordTranslationMode !== 2) {
          const targetId = entry?.vocabId || vocabId;
          if (targetId) {
            this.runWithMutationSuppressed(() => {
              document.querySelectorAll(`.traced-highlight[data-vocab-id="${targetId}"]`).forEach(el => {
                const surface = (el as HTMLElement).dataset.surface || el.textContent || '';
                el.parentNode?.replaceChild(document.createTextNode(surface), el);
                el.parentNode?.normalize();
              });
            });
            this.foundVocabIds.delete(targetId);
          }
          this.rebuildHighlightedVocab();
        } else {
          this.rebuildHighlightedVocab();
          const lemma = (entry?.lemma || word).toLowerCase();
          sendMessage<BatchTranslateWordsPayload, BatchTranslateWordsResult>('BATCH_TRANSLATE_WORDS', {
            words: [{ lemma, vocabId }], mode: 'smart'
          }).then(result => {
            for (const [key, data] of Object.entries(result.translations)) {
              if (data.meaning) this.translations.set(key.toLowerCase(), data.meaning);
            }
            if (this.enabled) this.runWithMutationSuppressed(() => this.scan());
          }).catch(() => {
            if (this.enabled) this.runWithMutationSuppressed(() => this.scan());
          });
        }
        sendResponse({ success: true });
        return false;
      }

      return false;
    });
  }

  private async reselect() {
    if (this.vocab.length === 0) return;
    clearTimeout(this.reselectDebounce);
    const seq = ++this.reselectionSeq;
    this.observer?.disconnect();
    clearTimeout(this.scanTimeout);
    this.pendingMutationRoots = [];
    try {
      this.runWithMutationSuppressed(() => this.removeHighlights());
      this.rebuildHighlightedVocab();
      this.sidebarVocab = [];
      if (this.enabled) this.runWithMutationSuppressed(() => this.scan());
    } catch {
      if (seq !== this.reselectionSeq) return;
      this.rebuildHighlightedVocab();
      this.sidebarVocab = [];
      if (this.enabled) this.runWithMutationSuppressed(() => this.scan());
    } finally {
      if (seq === this.reselectionSeq && this.observer) {
        this.observer.observe(document.body, { childList: true, subtree: true });
      }
    }
  }

  private removeHighlights() {
    const parents = new Set<Node>();
    document.querySelectorAll('.traced-highlight').forEach(el => {
      const surface = (el as HTMLElement).dataset.surface || el.textContent || '';
      if (el.parentNode) parents.add(el.parentNode);
      el.parentNode?.replaceChild(document.createTextNode(surface), el);
    });
    parents.forEach(node => node.normalize());
    this.foundVocabIds.clear();
  }

  private runWithMutationSuppressed(task: () => void) {
    const prev = this.suppressMutations;
    this.suppressMutations = true;
    try { task(); }
    finally { this.suppressMutations = prev; }
  }

  private getPageText(): string {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (['script', 'style', 'noscript', 'textarea', 'input', 'select'].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.closest('.trc-para-trans')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    const texts: string[] = [];
    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (text) texts.push(text);
    }
    return texts.join(' ');
  }

  private segmentSentences(text: string): string[] {
    try {
      if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
        const segmenter = new (Intl as any).Segmenter(navigator.language || 'en', { granularity: 'sentence' });
        const segments = segmenter.segment(text);
        const sentences: string[] = [];
        for (const segment of segments) {
          if (segment.segment.trim().length > 0) {
            sentences.push(segment.segment.trim());
          }
        }
        return sentences;
      }
    } catch (e) {
      console.warn('Intl.Segmenter failed, falling back to regex split', e);
    }
    return text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
  }

  private getPageMetadata() {
    const title = document.title;
    let favicon = '';
    const link = document.querySelector("link[rel~='icon']");
    if (link) {
      favicon = (link as HTMLLinkElement).href;
    } else {
      favicon = new URL('/favicon.ico', window.location.origin).href;
    }
    try {
      favicon = new URL(favicon, window.location.href).href;
    } catch { /* leave as is */ }
    return { title, favicon };
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    const highlights = document.querySelectorAll('.traced-highlight');
    highlights.forEach(el => {
      el.classList.toggle('hidden', !enabled);
    });
  }

  private async init() {
    try {
      // 1. Get Settings
      try {
        const settingsResponse = await sendMessage<unknown, {
          smartHighlightEnabled?: boolean;
          wordTranslationMode?: WordTranslationMode;
          paragraphTranslationEnabled?: boolean;
          preferences?: Record<string, unknown>;
        }>('GET_SETTINGS', {});

        const prefs = settingsResponse.preferences || {};
        const rawMode = settingsResponse.wordTranslationMode ?? prefs.wordTranslationMode;
        const mode: WordTranslationMode =
          rawMode === 0 || rawMode === 1 || rawMode === 2 ? rawMode as WordTranslationMode : 1;

        this.settings = {
          smartHighlightEnabled: settingsResponse.smartHighlightEnabled,
          wordTranslationMode: mode,
          paragraphTranslationEnabled: settingsResponse.paragraphTranslationEnabled ?? prefs.paragraphTranslationEnabled as boolean | undefined,
          wordTranslationStyle: prefs.wordTranslationStyle as WordTranslationStyle | undefined,
          paragraphTranslationStyle: prefs.paragraphTranslationStyle as ParagraphTranslationStyle | undefined,
          translationFontSizeEm: prefs.translationFontSizeEm as number | undefined,
          translationUnderlineStyle: prefs.translationUnderlineStyle as 'dotted' | 'dashed' | 'solid' | 'none' | undefined,
          translationDotSizePx: prefs.translationDotSizePx as number | undefined,
          translationTextColor: prefs.translationTextColor as string | undefined,
        };
        this.wordTranslationMode = mode;
        this.enabled = true;  // 高亮始终启用，wordTranslationMode 只控制翻译显示
        this.paragraphTranslationVisible = this.settings.paragraphTranslationEnabled === true;
        this.debugMode = prefs.debugMode === true;
        this.applyStyleSettings();
      } catch (err) {
        console.warn('Failed to get settings:', err);
      }

      // 2. Prepare Data
      const textContent = this.getPageText();
      const sentences = this.segmentSentences(textContent);
      const { title, favicon } = this.getPageMetadata();

      // 3. Scan Page Words
      const payload: ScanPageWordsPayload = {
        pageUrl: window.location.href,
        pageTitle: title,
        faviconUrl: favicon,
        textContent,
        sentences,
        record: true
      };

      const response = await sendMessage<ScanPageWordsPayload, ScanPageWordsResult>('SCAN_PAGE_WORDS', payload);
      this.vocab = response.matches.sort((a, b) => b.surface.length - a.surface.length);
      this.pageStats = response.stats || { coverage: 0, mastered: 0, topMissedWords: [] };

      // 4. Fetch translations for all vocab
      let dictCount = 0;
      let traceCount = 0;
      let apiCount = 0;
      let fetchError = '';
      if (this.vocab.length > 0) {
        try {
          const words = this.vocab.map(v => ({ lemma: v.lemma, vocabId: v.vocabId }));
          const transResult = await sendMessage<BatchTranslateWordsPayload, BatchTranslateWordsResult>('BATCH_TRANSLATE_WORDS', { words, mode: 'smart' });

          const needsAiTranslation: Array<{ lemma: string; vocabId: string }> = [];

          for (const [lemma, data] of Object.entries(transResult.translations)) {
            if (data.meaning) {
              this.translations.set(lemma.toLowerCase(), data.meaning);
              if (data.source === 'trace') traceCount++;
              else dictCount++;
            } else if (data.source === 'api') {
              apiCount++;
              const vocabItem = this.vocab.find(v => v.lemma.toLowerCase() === lemma.toLowerCase());
              if (vocabItem) {
                needsAiTranslation.push({ lemma: vocabItem.lemma, vocabId: vocabItem.vocabId });
              }
            }
          }

          if (needsAiTranslation.length > 0) {
            this.batchAiTranslate(needsAiTranslation);
          }
        } catch (err) {
          fetchError = err instanceof Error ? err.message : String(err);
        }
      }

      // 5. Apply highlight selection based on wordTranslationMode
      if (this.vocab.length > 0) {
        this.rebuildHighlightedVocab();
        this.sidebarVocab = [];

        if (this.debugMode) {
          this.debugStats = { dictCount, traceCount, apiCount, fetchError };
          this.updateDebugOverlay();
        }

        if (this.enabled) {
          this.scan();
          this.applyTranslationVisibility();
        }
      }

      // 6. Auto-enable paragraph translation if setting is on
      if (this.paragraphTranslationVisible) {
        this.setupParagraphObserver();
        this.scanParagraphs();
      }

      // 7. MutationObserver — incremental scan for new content only
      this.observer = new MutationObserver((mutations) => {
        if (this.suppressMutations || !this.enabled) return;
        for (const m of mutations) {
          if (m.type !== 'childList') continue;
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
              this.pendingMutationRoots.push(node);
            }
          }
        }
        if (this.pendingMutationRoots.length === 0) return;
        clearTimeout(this.scanTimeout);
        this.scanTimeout = window.setTimeout(() => {
          const roots = this.pendingMutationRoots.filter(n => n.isConnected);
          this.pendingMutationRoots = [];
          if (roots.length === 0) return;
          this.observer?.disconnect();
          this.runWithMutationSuppressed(() => this.scanSubtrees(roots));
          this.observer?.observe(document.body, { childList: true, subtree: true });
        }, 500);
      });

      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

    } catch (err) {
      console.error('TextScanner init failed:', err);
    }
  }

  // ====== Highlighting ======

  private getScoreColors(score: number): { dot: string; underline: string } {
    const s = Math.min(Math.max(score, 0), 100);
    const hue = Math.round(s * 1.2);
    return {
      dot: `hsl(${hue}, 72%, 48%)`,
      underline: `rgba(178, 34, 34, ${(0.6 - s * 0.004).toFixed(2)})`,
    };
  }

  private buildMatchState(): { pattern: RegExp; vocabMap: Map<string, VocabItem> } | null {
    if (this.highlightedVocab.length === 0) return null;
    const vocabMap = new Map<string, VocabItem>();
    for (const v of this.highlightedVocab) vocabMap.set(v.surface.toLowerCase(), v);
    const pattern = new RegExp(`\\b(${this.highlightedVocab.map(v => this.escapeRegExp(v.surface)).join('|')})\\b`, 'gi');
    return { pattern, vocabMap };
  }

  private collectTextNodes(root: Node): Text[] {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (EXCLUDED_TAGS.has(parent.tagName.toLowerCase())) return NodeFilter.FILTER_REJECT;
        if (parent.classList.contains('traced-highlight')) return NodeFilter.FILTER_REJECT;
        if (parent.closest('.traced-highlight')) return NodeFilter.FILTER_REJECT;
        if (parent.closest('.trc-para-trans')) return NodeFilter.FILTER_REJECT;
        if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while (node = walker.nextNode()) {
      if (node.textContent && node.textContent.trim().length > 0) {
        textNodes.push(node as Text);
      }
    }
    return textNodes;
  }

  private highlightTextNodes(textNodes: Text[], pattern: RegExp, vocabMap: Map<string, VocabItem>) {
    // 在 mode 2 下，需要匹配所有页面词库单词（不只是 traced）
    const allVocabPattern = this.wordTranslationMode === 2 ? this.buildAllVocabPattern() : null;
    const allVocabMap = allVocabPattern ? this.buildAllVocabMap() : null;

    for (const textNode of textNodes) {
      const text = textNode.textContent || '';

      // 使用合适的 pattern：mode 2 用 allVocabPattern，其他用 traced-only pattern
      const activePattern = allVocabPattern || pattern;
      const activeVocabMap = allVocabMap || vocabMap;

      activePattern.lastIndex = 0;
      if (!activePattern.test(text)) continue;
      activePattern.lastIndex = 0;

      const parts: (string | { item: VocabItem; text: string })[] = [];
      let lastIndex = 0;
      let match;

      while ((match = activePattern.exec(text)) !== null) {
        if (match.index > lastIndex) parts.push(text.substring(lastIndex, match.index));
        const vocabItem = activeVocabMap.get(match[0].toLowerCase());
        if (vocabItem) {
          parts.push({ item: vocabItem, text: match[0] });
          this.foundVocabIds.add(vocabItem.vocabId);
        } else {
          parts.push(match[0]);
        }
        lastIndex = activePattern.lastIndex;
      }

      if (lastIndex < text.length) parts.push(text.substring(lastIndex));

      if (parts.some(p => typeof p !== 'string')) {
        const fragment = document.createDocumentFragment();
        parts.forEach(part => {
          if (typeof part === 'string') {
            fragment.appendChild(document.createTextNode(part));
          } else {
            const { dot, underline } = this.getScoreColors(part.item.weightedScore);
            const isTraced = part.item.isTraced;
            const translation = this.translations.get(part.item.lemma.toLowerCase()) || '';
            const hideTranslation = this.wordTranslationMode === 0 || (this.wordTranslationMode === 1 && !isTraced);

            if (this.wordTranslationStyle === 'left') {
              const span = document.createElement('span');
              span.className = `traced-highlight trc-left ${isTraced ? 'traced-trace' : 'traced-library'}${hideTranslation ? ' trc-hidden' : ''}`;
              span.style.setProperty('--trc-dot', dot);
              span.style.setProperty('--trc-ul', underline);
              span.dataset.vocabId = part.item.vocabId;
              span.dataset.surface = part.text;
              span.dataset.lemma = part.item.lemma;

              const inline = document.createElement('span');
              inline.className = 'trc-inline-trans';
              if (translation) {
                inline.textContent = `(${translation})`;
                span.appendChild(inline);
              }
              span.appendChild(document.createTextNode(part.text));
              fragment.appendChild(span);
            } else {
              const ruby = document.createElement('ruby');
              ruby.className = `traced-highlight ${isTraced ? 'traced-trace' : 'traced-library'}${hideTranslation ? ' trc-hidden' : ''}`;
              ruby.style.setProperty('--trc-dot', dot);
              ruby.style.setProperty('--trc-ul', underline);
              ruby.dataset.vocabId = part.item.vocabId;
              ruby.dataset.surface = part.text;
              ruby.dataset.lemma = part.item.lemma;

              ruby.appendChild(document.createTextNode(part.text));
              const rp1 = document.createElement('rp');
              rp1.textContent = '(';
              ruby.appendChild(rp1);
              const rt = document.createElement('rt');
              rt.textContent = translation;
              ruby.appendChild(rt);
              const rp2 = document.createElement('rp');
              rp2.textContent = ')';
              ruby.appendChild(rp2);

              fragment.appendChild(ruby);
            }
          }
        });
        textNode.parentNode?.replaceChild(fragment, textNode);
      }
    }
  }

  private buildAllVocabPattern(): RegExp | null {
    const allVocab = (this.vocab as VocabItem[]).filter(v => !v.isKnown && (v.weightedScore ?? 0) <= 100);
    if (allVocab.length === 0) return null;
    return new RegExp(`\\b(${allVocab.map(v => this.escapeRegExp(v.surface)).join('|')})\\b`, 'gi');
  }

  private buildAllVocabMap(): Map<string, VocabItem> {
    const map = new Map<string, VocabItem>();
    const allVocab = (this.vocab as VocabItem[]).filter(v => !v.isKnown && (v.weightedScore ?? 0) <= 100);
    for (const v of allVocab) map.set(v.surface.toLowerCase(), v);
    return map;
  }

  private scan() {
    if (this.isScanning || !this.enabled) return;
    this.isScanning = true;
    try {
      const textNodes = this.collectTextNodes(document.body);
      if (this.wordTranslationMode === 2) {
        const pattern = this.buildAllVocabPattern();
        const map = this.buildAllVocabMap();
        if (!pattern) return;
        this.highlightTextNodes(textNodes, pattern, map);
        return;
      }
      const state = this.buildMatchState();
      if (!state) return;
      this.highlightTextNodes(textNodes, state.pattern, state.vocabMap);
    } finally {
      this.isScanning = false;
    }
  }

  private scanSubtrees(roots: Node[]) {
    if (!this.enabled) return;

    let pattern: RegExp | null;
    let vocabMap: Map<string, VocabItem>;

    if (this.wordTranslationMode === 2) {
      pattern = this.buildAllVocabPattern();
      vocabMap = this.buildAllVocabMap();
    } else {
      const state = this.buildMatchState();
      if (!state) return;
      pattern = state.pattern;
      vocabMap = state.vocabMap;
    }
    if (!pattern) return;

    for (const root of roots) {
      if (root.nodeType === Node.TEXT_NODE) {
        this.highlightTextNodes([root as Text], pattern, vocabMap);
      } else if (root.nodeType === Node.ELEMENT_NODE) {
        const el = root as HTMLElement;
        if (EXCLUDED_TAGS.has(el.tagName?.toLowerCase())) continue;
        if (el.classList.contains('traced-highlight')) continue;
        this.highlightTextNodes(this.collectTextNodes(el), pattern, vocabMap);
      }
    }
  }

  private escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private updateDebugOverlay() {
    let el = document.getElementById('traced-debug-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'traced-debug-overlay';
      el.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:2147483647;background:rgba(0,0,0,.85);color:#eee;font:11px/1.6 monospace;padding:10px 14px;border-radius:6px;pointer-events:none;max-width:340px';
      document.body.appendChild(el);
    }
    const { dictCount, traceCount, apiCount, fetchError } = this.debugStats;
    const tracedWords = this.vocab.filter(v => v.isTraced);
    const lines: string[] = [
      `mode=${this.wordTranslationMode} | highlighted=${this.highlightedVocab.length}`,
      `dict=${dictCount} trace=${traceCount} api=${apiCount} traced=${tracedWords.length}`,
    ];
    if (fetchError) lines.push(`[err] ${fetchError}`);
    if (tracedWords.length > 0) {
      lines.push('── traced words ──');
      for (const v of tracedWords.slice(0, 15)) {
        const trans = this.translations.get(v.lemma.toLowerCase());
        const score = v.weightedScore ?? 0;
        lines.push(`${v.lemma}: ${trans ? `"${trans}"` : '(no trans)'} score=${score}`);
      }
      if (tracedWords.length > 15) lines.push(`... +${tracedWords.length - 15} more`);
    }
    el.innerHTML = lines.map(l => {
      const d = document.createElement('div');
      d.textContent = l;
      return d.innerHTML;
    }).join('<br>');
  }

  private removeDebugOverlay() {
    document.getElementById('traced-debug-overlay')?.remove();
  }
}
