import { useState } from 'react';
import { Command } from 'cmdk';

function TestComponent() {
  const [value, setValue] = useState('');

  return (
    <Command label="Command Menu" shouldFilter={true}>
      <Command.Input
        value={value}
        onValueChange={setValue}
        placeholder="Type a command..."
      />
      <Command.List>
        <Command.Empty>No results found.</Command.Empty>
        <Command.Group heading="Actions">
          <Command.Item value="new-file">Create New File</Command.Item>
          <Command.Item value="new-folder">Create New Folder</Command.Item>
          <Command.Item value="search">Search Files</Command.Item>
        </Command.Group>
        <Command.Separator />
        <Command.Group heading="Settings">
          <Command.Item value="theme">Change Theme</Command.Item>
          <Command.Item value="lang">Change Language</Command.Item>
        </Command.Group>
      </Command.List>
    </Command>
  );
}

TestComponent.packageName = 'cmdk';
TestComponent.downloads = '8.4M/week';
export default TestComponent;
