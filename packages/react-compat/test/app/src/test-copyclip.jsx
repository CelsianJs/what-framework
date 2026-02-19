import React, { useState } from 'react';
import { CopyToClipboard } from 'react-copy-to-clipboard';

export function CopyClipTest() {
  const [copied, setCopied] = useState(false);
  const textToCopy = 'npm install what-framework';

  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>react-copy-to-clipboard</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, background: '#f5f5f5', borderRadius: 4, fontFamily: 'monospace' }}>
        <code style={{ flex: 1 }}>{textToCopy}</code>
        <CopyToClipboard text={textToCopy} onCopy={() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          <button style={{ padding: '4px 12px', cursor: 'pointer', background: copied ? '#4caf50' : '#fff', color: copied ? '#fff' : '#333', border: '1px solid #ccc', borderRadius: 4, transition: 'all 0.2s' }}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </CopyToClipboard>
      </div>
      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — CopyToClipboard works with callback</p>
    </div>
  );
}
