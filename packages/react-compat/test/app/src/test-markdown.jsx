/**
 * Test: react-markdown — render Markdown as React components
 * 2.4M weekly downloads. Single component, plugin system.
 */
import Markdown from 'react-markdown';

const sampleMd = `
# Hello from What Framework

This markdown is rendered by **react-markdown** running on the
\`what-react\` compatibility layer.

## Features tested:
- **Bold** and *italic* text
- Inline \`code\` and code blocks
- [Links](https://example.com)
- Lists (this one!)

\`\`\`javascript
// Signals-based reactivity
const count = signal(0);
effect(() => console.log(count()));
\`\`\`

> Blockquote: What Framework makes signals feel native.

---

*Rendered successfully via what-react.*
`;

export function MarkdownTest() {
  return (
    <div>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', background: '#fafafa', maxWidth: '600px' }}>
        <Markdown>{sampleMd}</Markdown>
      </div>
      <p style={{ color: 'green' }} id="markdown-status">React Markdown loaded OK</p>
    </div>
  );
}
