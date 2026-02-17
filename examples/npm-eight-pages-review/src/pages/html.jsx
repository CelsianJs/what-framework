import { useEffect, useSignal } from 'what-framework';

export const page = {
  mode: 'client',
};

const FIRST_HTML = '<strong>Safe preview:</strong> manual innerHTML update path';
const SECOND_HTML = '<em>Updated preview:</em> string changed via signal';

const FIRST_SVG = '<circle cx="24" cy="24" r="16" fill="#2563eb"></circle>';
const SECOND_SVG = '<rect x="8" y="8" width="32" height="32" rx="4" fill="#059669"></rect>';

export default function HtmlPage() {
  const htmlSnippet = useSignal(FIRST_HTML);
  const dangerousSnippet = useSignal('<span class="pill">Danger API payload</span>');
  const svgSnippet = useSignal(FIRST_SVG);

  const htmlRef = { current: null };
  const dangerousRef = { current: null };
  const svgRef = { current: null };

  useEffect(() => {
    if (htmlRef.current) {
      htmlRef.current.innerHTML = htmlSnippet();
    }
  }, [htmlSnippet()]);

  useEffect(() => {
    if (dangerousRef.current) {
      dangerousRef.current.innerHTML = dangerousSnippet();
    }
  }, [dangerousSnippet()]);

  useEffect(() => {
    if (svgRef.current) {
      svgRef.current.innerHTML = svgSnippet();
    }
  }, [svgSnippet()]);

  return (
    <section>
      <h1 class="page-title">innerHTML and dangerouslySetInnerHTML</h1>
      <p class="lead">
        This page uses refs + <code>useEffect</code> because JSX <code>innerHTML</code> prop compilation
        currently fails in npm package <code>0.4.2</code>.
      </p>

      <div class="card split-grid">
        <div>
          <h2>manual innerHTML</h2>
          <div class="html-box" ref={htmlRef} />
          <div class="button-row">
            <button class="btn" onClick={() => htmlSnippet(FIRST_HTML)}>Reset</button>
            <button class="btn btn-primary" onClick={() => htmlSnippet(SECOND_HTML)}>Update</button>
          </div>
        </div>

        <div>
          <h2>manual dangerous payload</h2>
          <div class="html-box" ref={dangerousRef} />
          <div class="button-row">
            <button class="btn" onClick={() => dangerousSnippet('<span class="pill">Danger API payload</span>')}>
              Default
            </button>
            <button
              class="btn btn-primary"
              onClick={() => dangerousSnippet('<span class="pill">New trusted payload</span>')}
            >
              Swap
            </button>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>manual SVG innerHTML</h2>
        <svg class="svg-box" viewBox="0 0 48 48" ref={svgRef} />
        <div class="button-row">
          <button class="btn" onClick={() => svgSnippet(FIRST_SVG)}>Circle</button>
          <button class="btn btn-primary" onClick={() => svgSnippet(SECOND_SVG)}>Rectangle</button>
        </div>
      </div>
    </section>
  );
}
