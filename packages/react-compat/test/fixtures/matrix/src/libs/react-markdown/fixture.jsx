import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Code, Item } from './parts.jsx';

const initial = `# Title

Some **bold** and *emphasis* and ~~struck~~ text with a [link](https://example.com).

- one
- two

| a | b |
|---|---|
| 1 | 2 |

- [x] done
- [ ] todo

\`\`\`js
const x = 1;
\`\`\`

<script>alert(1)</script>
`;
// The same document with a paragraph before the first one: every block after
// it moves down one place.
const withIntro = initial.replace('# Title\n', '# Title\n\nAn intro line.\n');

export default function Fixture() {
  const [source, setSource] = useState(initial);
  const [clicked, setClicked] = useState('');
  return (
    <div>
      <textarea id="md-source" value={source} onChange={(e) => setSource(e.target.value)} rows={4} />
      <button id="md-set" onClick={() => setSource('## Changed\n\n1. first\n2. second')}>replace</button>
      <button id="md-intro" onClick={() => setSource(withIntro)}>add an intro</button>
      <span id="md-clicked">{clicked}</span>
      <div id="md-out">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ node, ...props }) => (
              <a className="md-link" target="_blank" rel="noreferrer" {...props} onClick={(e) => { e.preventDefault(); setClicked(`${e.currentTarget.getAttribute('href')}:${e.isDefaultPrevented()}`); }} />
            ),
            code: Code,
            li: Item,
            h1: ({ node, children, ...props }) => <h1 data-custom="yes" {...props}>{children}!</h1>,
          }}
        >
          {source}
        </Markdown>
      </div>
    </div>
  );
}
