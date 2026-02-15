import { useState, useEffect, useCallback } from 'react';
import { preloadTranslation } from '../preload';

interface SelectionData {
  text: string;
  rect: DOMRect;
  contextSentence: string;
  locator: {
    textQuote: string;
    xpath: string;
    startOffset: number;
  };
}

export function useSelection() {
  const [selection, setSelection] = useState<SelectionData | null>(null);

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  useEffect(() => {
    const handleMouseUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        return;
      }

      const text = sel.toString().trim();
      if (!text || text.length > 200) {
        return;
      }

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Get context sentence
      const contextSentence = getContextSentence(range);

      // Get locator info
      const locator = {
        textQuote: text,
        xpath: getXPath(range.startContainer),
        startOffset: range.startOffset,
      };

      setSelection({ text, rect, contextSentence, locator });

      // Preload translation immediately
      preloadTranslation(text, contextSentence);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearSelection();
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [clearSelection]);

  return { selection, clearSelection };
}

function getContextSentence(range: Range): string {
  const container = range.startContainer;
  const text = container.textContent || '';

  // Find the position of selected text in the container
  const startOffset = range.startOffset;
  const endOffset = range.endOffset;

  // Extract a phrase around the selected word (not the whole sentence)
  // Look for natural phrase boundaries: commas, conjunctions, or ~30 chars
  const beforeLength = Math.min(30, startOffset);
  const afterLength = Math.min(30, text.length - endOffset);

  let phraseStart = Math.max(0, startOffset - beforeLength);
  let phraseEnd = Math.min(text.length, endOffset + afterLength);

  // Try to find natural boundaries (spaces, commas, etc.)
  // Look backwards for a good starting point
  for (let i = phraseStart; i < startOffset; i++) {
    if (/[\s,;]/.test(text[i])) {
      phraseStart = i + 1;
      break;
    }
  }

  // Look forwards for a good ending point
  for (let i = phraseEnd - 1; i > endOffset; i--) {
    if (/[\s,;.]/.test(text[i])) {
      phraseEnd = i;
      break;
    }
  }

  let phrase = text.slice(phraseStart, phraseEnd).trim();

  // Add ellipsis if we cut off text
  if (phraseStart > 0) phrase = '...' + phrase;
  if (phraseEnd < text.length) phrase = phrase + '...';

  return phrase;
}

function getXPath(node: Node): string {
  if (node.nodeType === Node.DOCUMENT_NODE) {
    return '/';
  }

  const parts: string[] = [];
  let current: Node | null = node;

  while (current && current.nodeType !== Node.DOCUMENT_NODE) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as Element;
      let index = 1;
      let sibling = el.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === el.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${el.tagName.toLowerCase()}[${index}]`);
    }
    current = current.parentNode;
  }

  return '/' + parts.join('/');
}
