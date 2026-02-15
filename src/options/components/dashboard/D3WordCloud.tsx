import { useRef, useEffect, useState, useCallback } from 'react';
import cloud from 'd3-cloud';

export interface CloudWord {
  text: string;
  value: number;
  source: 'environment' | 'wordbank';
  mastered?: boolean;
}

interface LayoutWord {
  text: string;
  size: number;
  x: number;
  y: number;
  rotate: number;
  font: string;
  weight: string | number;
  color: string;
  source: 'environment' | 'wordbank';
  mastered?: boolean;
  value: number;
}

interface Props {
  data: CloudWord[];
  dark?: boolean;
  onWordClick?: (word: { lemma: string; source: string; totalCount: number }) => void;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const PALETTES = {
  env:      ['#B22222', '#DAA520', '#4682B4', '#D2691E', '#CD853F', '#8B4513'],
  wb:       ['#2E8B57', '#4682B4', '#6A5ACD', '#4B5563', '#2F4F4F', '#008080'],
  mastered: ['#2E8B57', '#228B22', '#3CB371'],
};

export function D3WordCloud({ data, dark: _dark, onWordClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [words, setWords] = useState<LayoutWord[]>([]);
  const [size, setSize] = useState<[number, number]>([800, 400]);
  const [viewBox, setViewBox] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width } = entries[0].contentRect;
      if (width > 0) {
        const h = Math.max(320, Math.min(width * 0.5, 500));
        setSize([Math.floor(width), Math.floor(h)]);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const runLayout = useCallback(() => {
    if (!data.length || size[0] < 100) return;

    const maxVal = Math.max(...data.map(d => d.value));
    const minVal = Math.min(...data.map(d => d.value));
    const logScale = (v: number) => {
      if (maxVal === minVal) return 0.5;
      const norm = (v - minVal) / (maxVal - minVal);
      return Math.log1p(norm * 9) / Math.log1p(9);
    };

    const minFont = 11;
    const maxFont = Math.max(48, Math.min(70, size[0] / 12));

    const colorOf = (d: CloudWord) => {
      const h0 = hash(d.text);
      if (d.mastered) return PALETTES.mastered[h0 % PALETTES.mastered.length];
      if (d.source === 'environment') return PALETTES.env[h0 % PALETTES.env.length];
      return PALETTES.wb[h0 % PALETTES.wb.length];
    };

    const items = data.slice(0, 150);

    const layout = (cloud as any)()
      .size(size)
      .words(items.map(d => ({
        text: d.text,
        rawValue: d.value,
        size: minFont + logScale(d.value) * (maxFont - minFont),
        source: d.source,
        mastered: d.mastered,
        color: colorOf(d),
      })))
      .padding(4)
      .rotate((_d: any, i: number) => {
        const h0 = hash(items[i]?.text || '' + i);
        return h0 % 8 < 2 ? 90 : 0;
      })
      .font('Arial, Helvetica, sans-serif')
      .fontWeight(700)
      .fontSize((d: any) => d.size)
      .spiral('rectangular')
      .random(() => 0.5)
      .on('end', (tags: any[]) => {
        const placed: LayoutWord[] = tags.map(t => ({
          text: t.text!,
          size: t.size!,
          x: t.x!,
          y: t.y!,
          rotate: t.rotate!,
          font: t.font!,
          weight: t.weight!,
          color: t.color,
          source: t.source,
          mastered: t.mastered,
          value: t.rawValue,
        }));
        setWords(placed);

        // Compute tight bounding box of placed words, then fit viewBox to fill container
        if (placed.length > 0) {
          let bxMin = Infinity, bxMax = -Infinity, byMin = Infinity, byMax = -Infinity;
          for (const w of placed) {
            // Rough bbox: for rotated words swap width/height estimate
            const charW = w.size * 0.6 * w.text.length;
            const charH = w.size * 1.2;
            const isVert = Math.abs(w.rotate) === 90;
            const hw = (isVert ? charH : charW) / 2;
            const hh = (isVert ? charW : charH) / 2;
            bxMin = Math.min(bxMin, w.x - hw);
            bxMax = Math.max(bxMax, w.x + hw);
            byMin = Math.min(byMin, w.y - hh);
            byMax = Math.max(byMax, w.y + hh);
          }
          const contentW = bxMax - bxMin;
          const contentH = byMax - byMin;
          const margin = 12;
          // Scale content to fill the container's aspect ratio
          const [cw, ch] = size;
          const aspect = cw / ch;
          const contentAspect = contentW / contentH;
          let vbW: number, vbH: number;
          if (contentAspect > aspect) {
            // content is wider — fit width, expand height
            vbW = contentW + margin * 2;
            vbH = vbW / aspect;
          } else {
            // content is taller — fit height, expand width
            vbH = contentH + margin * 2;
            vbW = vbH * aspect;
          }
          const cx = (bxMin + bxMax) / 2;
          const cy = (byMin + byMax) / 2;
          setViewBox(`${cx - vbW / 2} ${cy - vbH / 2} ${vbW} ${vbH}`);
        }
      });

    layout.start();
  }, [data, size]);

  useEffect(() => { runLayout(); }, [runLayout]);

  const [w, h] = size;

  return (
    <div ref={containerRef} className="w-full">
      {words.length > 0 && (
        <svg
          width={w}
          height={h}
          viewBox={viewBox || `${-w / 2} ${-h / 2} ${w} ${h}`}
          preserveAspectRatio="xMidYMid meet"
          className="block"
          style={{ userSelect: 'none' }}
        >
          <g>
            {words.map(word => {
              const isHovered = hovered === word.text;
              return (
                <text
                  key={word.text}
                  textAnchor="middle"
                  transform={`translate(${word.x},${word.y}) rotate(${word.rotate})`}
                  style={{
                    fontSize: word.size,
                    fontFamily: word.font,
                    fontWeight: word.weight as any,
                    fill: word.color,
                    cursor: 'pointer',
                    opacity: isHovered ? 1 : 0.85,
                    transition: 'opacity 0.15s',
                    ...(isHovered ? { filter: `drop-shadow(0 0 4px ${word.color}40)` } : {}),
                  }}
                  onMouseEnter={() => setHovered(word.text)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => onWordClick?.({ lemma: word.text, source: word.source, totalCount: word.value })}
                >
                  {word.text}
                </text>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
}
