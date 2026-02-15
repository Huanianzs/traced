import React from 'react';

interface InkDropProps {
  rect: DOMRect;
  onClick: () => void;
}

export function InkDrop({ rect, onClick }: InkDropProps) {
  const style: React.CSSProperties = {
    position: 'absolute',
    top: rect.bottom + window.scrollY + 4,
    left: rect.left + window.scrollX + rect.width / 2 - 14,
    zIndex: 2147483646,
  };

  return (
    <button
      onClick={onClick}
      style={style}
      className="w-7 h-7 rounded-full bg-white border border-neutral-200 shadow-card flex items-center justify-center hover:shadow-float hover:border-brand-seal transition-all animate-scale-in"
      title="Translate with Traced"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-brand-seal">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    </button>
  );
}
