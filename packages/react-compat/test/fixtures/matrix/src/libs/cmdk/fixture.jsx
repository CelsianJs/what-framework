import { useState } from 'react';
import { Command } from 'cmdk';

function Items({ onPick }) {
  return (
    <>
      <Command.Empty>No results.</Command.Empty>
      <Command.Group heading="Fruits">
        <Command.Item onSelect={onPick}>Apple</Command.Item>
        <Command.Item onSelect={onPick}>Banana</Command.Item>
        <Command.Item onSelect={onPick}>Cherry</Command.Item>
      </Command.Group>
      <Command.Group heading="Tools">
        <Command.Item onSelect={onPick}>Hammer</Command.Item>
        <Command.Item onSelect={onPick}>Wrench</Command.Item>
      </Command.Group>
    </>
  );
}

export default function Fixture() {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState('none');
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Command label="Inline menu" id="ck-root">
        <Command.Input value={search} onValueChange={setSearch} placeholder="Search" />
        <Command.List><Items onPick={setPicked} /></Command.List>
      </Command>
      <span id="ck-search">{search}</span>
      <span id="ck-picked">{picked}</span>
      <button id="ck-open" onClick={() => setOpen(true)}>Open palette</button>
      <Command.Dialog open={open} onOpenChange={setOpen} label="Palette">
        <Command.Input placeholder="Type a command" />
        <Command.List><Items onPick={(value) => { setPicked('dialog:' + value); setOpen(false); }} /></Command.List>
      </Command.Dialog>
    </div>
  );
}
