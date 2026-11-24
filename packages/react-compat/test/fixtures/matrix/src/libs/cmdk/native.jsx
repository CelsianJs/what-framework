// fixture.jsx as a native What file: signals for state, the Command tags are islands.
import { signal } from 'what-framework';
import { Command } from 'cmdk';

export default function Native() {
  const search = signal('');
  const picked = signal('none');
  const open = signal(false);
  const pickInDialog = (value) => { picked('dialog:' + value); open(false); };
  return (
    <div>
      <Command label="Inline menu" id="ck-root">
        <Command.Input value={search()} onValueChange={(next) => search(next)} placeholder="Search" />
        <Command.List>
          <Command.Empty>No results.</Command.Empty>
          <Command.Group heading="Fruits">
            <Command.Item onSelect={(value) => picked(value)}>Apple</Command.Item>
            <Command.Item onSelect={(value) => picked(value)}>Banana</Command.Item>
            <Command.Item onSelect={(value) => picked(value)}>Cherry</Command.Item>
          </Command.Group>
          <Command.Group heading="Tools">
            <Command.Item onSelect={(value) => picked(value)}>Hammer</Command.Item>
            <Command.Item onSelect={(value) => picked(value)}>Wrench</Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
      <span id="ck-search">{search()}</span>
      <span id="ck-picked">{picked()}</span>
      <button id="ck-open" onClick={() => open(true)}>Open palette</button>
      <Command.Dialog open={open()} onOpenChange={(next) => open(next)} label="Palette">
        <Command.Input placeholder="Type a command" />
        <Command.List>
          <Command.Empty>No results.</Command.Empty>
          <Command.Group heading="Fruits">
            <Command.Item onSelect={pickInDialog}>Apple</Command.Item>
            <Command.Item onSelect={pickInDialog}>Banana</Command.Item>
            <Command.Item onSelect={pickInDialog}>Cherry</Command.Item>
          </Command.Group>
          <Command.Group heading="Tools">
            <Command.Item onSelect={pickInDialog}>Hammer</Command.Item>
            <Command.Item onSelect={pickInDialog}>Wrench</Command.Item>
          </Command.Group>
        </Command.List>
      </Command.Dialog>
    </div>
  );
}
