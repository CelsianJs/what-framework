import { useState } from 'react';
import { CopyToClipboard } from 'react-copy-to-clipboard';

function TestComponent() {
  const [copied, setCopied] = useState(false);
  const textToCopy = 'Hello from What Framework!';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, color: '#aaa', fontFamily: 'monospace', background: '#1a1a1a', padding: '4px 8px', borderRadius: 4 }}>
        {textToCopy}
      </div>
      <CopyToClipboard text={textToCopy} onCopy={() => setCopied(true)}>
        <button
          style={{
            padding: '4px 12px',
            background: copied ? '#22c55e' : '#333',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
            transition: 'background 0.2s',
          }}
        >
          {copied ? 'Copied!' : 'Copy to Clipboard'}
        </button>
      </CopyToClipboard>
    </div>
  );
}

TestComponent.packageName = 'react-copy-to-clipboard';
TestComponent.downloads = '1.8M/week';
export default TestComponent;
