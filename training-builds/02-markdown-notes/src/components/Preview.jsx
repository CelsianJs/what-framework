import { useSignal, useRef, effect, onCleanup } from 'what-framework';
import { parseMarkdown } from '../utils/markdown';

export function Preview({ note }) {
  const renderedHtml = useSignal('');
  const previewRef = useRef(null);
  const lastContent = useRef(null);

  // Use effect to watch note changes and render markdown as a side effect
  let debounceTimer = null;
  effect(() => {
    const current = note();
    if (!current) {
      renderedHtml('');
      lastContent.current = null;
      return;
    }

    const content = current.content || '';
    if (content !== lastContent.current) {
      lastContent.current = content;

      // Render immediately for the first load or if no HTML yet
      if (!renderedHtml()) {
        renderedHtml(parseMarkdown(content));
      }

      // Debounced render for subsequent updates
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        renderedHtml(parseMarkdown(content));
      }, 150);
    }
  });

  onCleanup(() => {
    clearTimeout(debounceTimer);
  });

  return (
    <div style="flex: 1; display: flex; flex-direction: column; height: 100%; border-left: 1px solid #1a1a1a; overflow-y: auto;">
      {() => {
        const current = note();
        if (!current) {
          return (
            <div style="flex: 1; display: flex; align-items: center; justify-content: center; color: #444;">
              <p style="font-size: 0.9375rem;">Preview will appear here</p>
            </div>
          );
        }

        const html = renderedHtml();

        return (
          <div style="padding: 1.5rem;">
            <div style="font-size: 0.6875rem; color: #444; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem;">
              Preview
            </div>
            <div
              ref={previewRef}
              style="line-height: 1.7; font-size: 0.9375rem;"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        );
      }}
    </div>
  );
}
