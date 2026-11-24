import { useState } from 'react';
import {
  Combobox, ComboboxInput, ComboboxOption, ComboboxOptions,
  Dialog, DialogPanel, DialogTitle,
  Disclosure, DisclosureButton, DisclosurePanel,
  Listbox, ListboxButton, ListboxOption, ListboxOptions,
  Menu, MenuButton, MenuItem, MenuItems,
  Switch, Tab, TabGroup, TabList, TabPanel, TabPanels,
} from '@headlessui/react';

const people = ['Ada', 'Grace', 'Linus', 'Margaret'];

export default function Fixture() {
  const [picked, setPicked] = useState('none');
  const [on, setOn] = useState(false);
  const [person, setPerson] = useState(people[0]);
  const [combo, setCombo] = useState(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const filtered = query === '' ? people : people.filter((p) => p.toLowerCase().includes(query.toLowerCase()));
  return (
    <div>
      <Menu>
        <MenuButton id="hm-button">Options</MenuButton>
        <MenuItems id="hm-items" anchor="bottom start">
          <MenuItem><button onClick={() => setPicked('edit')}>Edit</button></MenuItem>
          <MenuItem><button onClick={() => setPicked('delete')}>Delete</button></MenuItem>
        </MenuItems>
      </Menu>
      <span id="hm-picked">{picked}</span>

      <Switch id="hs-switch" checked={on} onChange={setOn}>{on ? 'on' : 'off'}</Switch>

      <Listbox value={person} onChange={setPerson}>
        <ListboxButton id="hl-button">{person}</ListboxButton>
        <ListboxOptions id="hl-options" anchor="bottom">
          {people.map((p) => <ListboxOption key={p} value={p}>{p}</ListboxOption>)}
        </ListboxOptions>
      </Listbox>
      <span id="hl-value">{person}</span>

      <Combobox value={combo} onChange={setCombo} onClose={() => setQuery('')}>
        <ComboboxInput id="hc-input" displayValue={(p) => p ?? ''} onChange={(e) => setQuery(e.target.value)} />
        <ComboboxOptions id="hc-options" anchor="bottom">
          {filtered.map((p) => <ComboboxOption key={p} value={p}>{p}</ComboboxOption>)}
        </ComboboxOptions>
      </Combobox>
      <span id="hc-value">{String(combo)}</span>

      <button id="hd-open" onClick={() => setOpen(true)}>Open dialog</button>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <div style={{ position: 'fixed', inset: 0 }}>
          <DialogPanel id="hd-panel" style={{ margin: 40, background: 'white' }}>
            <DialogTitle>Payment</DialogTitle>
            <input id="hd-input" />
            <button id="hd-done" onClick={() => setOpen(false)}>Done</button>
          </DialogPanel>
        </div>
      </Dialog>

      <Disclosure>
        <DisclosureButton id="hx-button">Details</DisclosureButton>
        <DisclosurePanel id="hx-panel">Hidden details</DisclosurePanel>
      </Disclosure>

      <TabGroup>
        <TabList>
          <Tab id="ht-1">First</Tab>
          <Tab id="ht-2">Second</Tab>
        </TabList>
        <TabPanels>
          <TabPanel id="ht-panel-1">first panel</TabPanel>
          <TabPanel id="ht-panel-2">second panel</TabPanel>
        </TabPanels>
      </TabGroup>
    </div>
  );
}
