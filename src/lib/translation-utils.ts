export function extractTranslationLine(text: string, type: 'default' | 'poetry' | 'webnovel'): string {
  if (type === 'default') {
    const match = text.match(/翻译[:：]\s*(.+)/);
    if (match) return match[1].trim();
    return text.split('\n')[0].trim();
  }

  const prefix = type === 'poetry' ? '诗意:' : '网文:';
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      return line.replace(prefix, '').trim();
    }
  }
  return '';
}
