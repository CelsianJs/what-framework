import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import js from 'react-syntax-highlighter/dist/esm/languages/hljs/javascript';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';

SyntaxHighlighter.registerLanguage('javascript', js);

const code = `import { signal, effect } from '@what/core';

const count = signal(0);

effect(() => {
  console.log('Count is:', count());
});

count.set(prev => prev + 1);`;

export function SyntaxTest() {
  return (
    <div>
      <SyntaxHighlighter language="javascript" style={atomOneDark} customStyle={{ borderRadius: '8px', fontSize: '13px' }}>
        {code}
      </SyntaxHighlighter>
      <p style={{ color: 'green', marginTop: '4px' }}>react-syntax-highlighter with atom-one-dark theme</p>
    </div>
  );
}
