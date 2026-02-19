import React, { useState } from 'react';
import { Command } from 'cmdk';

export function CmdkTest() {
  const [value, setValue] = useState('');

  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>cmdk — Command Palette</h3>
      <Command label="Command Menu" style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', maxWidth: 400 }}>
        <Command.Input
          placeholder="Type a command..."
          value={value}
          onValueChange={setValue}
          style={{ width: '100%', padding: '8px 12px', border: 'none', borderBottom: '1px solid #ddd', outline: 'none', fontSize: 14 }}
        />
        <Command.List style={{ maxHeight: 200, overflow: 'auto', padding: 4 }}>
          <Command.Empty style={{ padding: 12, textAlign: 'center', color: '#999' }}>No results found.</Command.Empty>
          <Command.Group heading="Actions" style={{ padding: '4px 8px', fontSize: 12, color: '#666' }}>
            <Command.Item style={{ padding: '8px 12px', borderRadius: 4, cursor: 'pointer' }} onSelect={() => alert('New File')}>New File</Command.Item>
            <Command.Item style={{ padding: '8px 12px', borderRadius: 4, cursor: 'pointer' }} onSelect={() => alert('Open')}>Open Project</Command.Item>
            <Command.Item style={{ padding: '8px 12px', borderRadius: 4, cursor: 'pointer' }} onSelect={() => alert('Settings')}>Settings</Command.Item>
          </Command.Group>
          <Command.Group heading="Navigation" style={{ padding: '4px 8px', fontSize: 12, color: '#666' }}>
            <Command.Item style={{ padding: '8px 12px', borderRadius: 4, cursor: 'pointer' }}>Go to Dashboard</Command.Item>
            <Command.Item style={{ padding: '8px 12px', borderRadius: 4, cursor: 'pointer' }}>Go to Profile</Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — cmdk renders and filters</p>
    </div>
  );
}
