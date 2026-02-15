import { useState, useEffect } from 'react';

interface Position {
  top: number;
  left: number;
  placement: 'bottom' | 'top';
}

export function useSmartPosition(
  rect: DOMRect | null,
  cardHeight: number = 300
): Position | null {
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    if (!rect) {
      setPosition(null);
      return;
    }

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;

    const cardWidth = 320;
    const gap = 8;

    // Calculate horizontal position (centered on selection)
    let left = rect.left + scrollX + rect.width / 2 - cardWidth / 2;
    // Clamp to viewport
    left = Math.max(scrollX + 8, Math.min(left, scrollX + viewportWidth - cardWidth - 8));

    // Calculate vertical position
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;

    let top: number;
    let placement: 'bottom' | 'top';

    if (spaceBelow >= cardHeight + gap || spaceBelow >= spaceAbove) {
      // Place below
      top = rect.bottom + scrollY + gap;
      placement = 'bottom';
    } else {
      // Place above
      top = rect.top + scrollY - cardHeight - gap;
      placement = 'top';
    }

    setPosition({ top, left, placement });
  }, [rect, cardHeight]);

  return position;
}
