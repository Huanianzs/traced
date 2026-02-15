import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useSelection } from './hooks/useSelection';
import { useSmartPosition } from './hooks/useSmartPosition';
import { InkDrop } from './components/InkDrop';
import { InkCard } from './components/InkCard';
import { TextScanner } from './scanner';
import { SHADOW_STYLES } from './shadow-styles';

// Initialize TextScanner (smart highlighting)
new TextScanner();


function App() {
  const { selection, clearSelection } = useSelection();
  const [showCard, setShowCard] = useState(false);
  const position = useSmartPosition(selection?.rect ?? null);

  const handleDropClick = () => {
    setShowCard(true);
  };

  const handleClose = () => {
    setShowCard(false);
    clearSelection();
  };

  if (!selection) return null;

  return (
    <>
      {!showCard && (
        <InkDrop rect={selection.rect} onClick={handleDropClick} />
      )}
      {showCard && position && (
        <InkCard
          word={selection.text}
          contextSentence={selection.contextSentence}
          position={position}
          locator={selection.locator}
          onClose={handleClose}
        />
      )}
    </>
  );
}

// Mount with Shadow DOM
function mount() {
  // Prevent duplicate mounts
  if (document.getElementById('traced-root')) return;

  const host = document.createElement('div');
  host.id = 'traced-root';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });

  // Inject styles
  const style = document.createElement('style');
  style.textContent = SHADOW_STYLES;
  shadow.appendChild(style);

  // Create React root
  const container = document.createElement('div');
  shadow.appendChild(container);

  const root = createRoot(container);
  root.render(<App />);
}

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
