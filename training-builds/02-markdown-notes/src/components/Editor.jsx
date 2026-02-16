import { useRef, onMount, onCleanup, debounce } from 'what-framework';

export function Editor({ note, onUpdate }) {
  const textareaRef = useRef(null);
  const pendingSave = useRef(null);

  const debouncedSave = debounce((content) => {
    onUpdate(content);
    pendingSave.current = null;
  }, 300);

  const handleInput = (e) => {
    const content = e.target.value;
    pendingSave.current = content;
    debouncedSave(content);
    autoResize(e.target);
  };

  const autoResize = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };

  onMount(() => {
    const el = textareaRef.current;
    if (el) {
      el.focus();
      autoResize(el);
    }
  });

  onCleanup(() => {
    // Flush any pending save
    if (pendingSave.current !== null) {
      onUpdate(pendingSave.current);
      pendingSave.current = null;
    }
  });

  return (
    <div style="flex: 1; display: flex; flex-direction: column; height: 100%; overflow-y: auto;">
      {() => {
        const current = note();
        if (!current) {
          return (
            <div style="flex: 1; display: flex; align-items: center; justify-content: center; color: #444;">
              <p style="font-size: 0.9375rem;">Select a note or create a new one</p>
            </div>
          );
        }

        return (
          <div style="flex: 1; display: flex; flex-direction: column; padding: 1.5rem;">
            {/* Title display */}
            <div style="font-size: 0.6875rem; color: #444; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">
              Editing
            </div>
            <textarea
              ref={textareaRef}
              value={current.content}
              oninput={handleInput}
              placeholder="Start writing in Markdown..."
              style="flex: 1; width: 100%; min-height: 300px; background: transparent; border: none; color: #e5e5e5; font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; font-size: 0.875rem; line-height: 1.7; resize: none; outline: none; padding: 0;"
            />
          </div>
        );
      }}
    </div>
  );
}
