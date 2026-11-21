import { useSignal } from 'what-framework';

export const page = {
  mode: 'client',
};

const FIRST_HTML = '<strong>Safe preview:</strong> innerHTML update path';
const SECOND_HTML = '<em>Updated preview:</em> string changed via signal';

const FIRST_SVG = '<circle cx="24" cy="24" r="16" fill="#2563eb"></circle>';
const SECOND_SVG = '<rect x="8" y="8" width="32" height="32" rx="4" fill="#059669"></rect>';

export default function HtmlPage() {
  const htmlSnippet = useSignal(FIRST_HTML);
  const dangerousSnippet = useSignal('<span class="pill">Danger API payload</span>');
  const svgSnippet = useSignal(FIRST_SVG);

  return (
    <section>
      <h1 class="page-title">innerHTML and dangerouslySetInnerHTML</h1>
      <p class="lead">
        Both props take <code>{'{ __html }'}</code>: a plain string is refused, so markup is always opted into on purpose.
      </p>

      <div class="card split-grid">
        <div>
          <h2>innerHTML</h2>
          <div class="html-box" innerHTML={{ __html: htmlSnippet() }} />
          <div class="button-row">
            <button class="btn" onClick={() => htmlSnippet(FIRST_HTML)}>Reset</button>
            <button class="btn btn-primary" onClick={() => htmlSnippet(SECOND_HTML)}>Update</button>
          </div>
        </div>

        <div>
          <h2>dangerouslySetInnerHTML</h2>
          <div class="html-box" dangerouslySetInnerHTML={{ __html: dangerousSnippet() }} />
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
        <h2>SVG innerHTML</h2>
        <svg class="svg-box" viewBox="0 0 48 48" innerHTML={{ __html: svgSnippet() }} />
        <div class="button-row">
          <button class="btn" onClick={() => svgSnippet(FIRST_SVG)}>Circle</button>
          <button class="btn btn-primary" onClick={() => svgSnippet(SECOND_SVG)}>Rectangle</button>
        </div>
      </div>
    </section>
  );
}
