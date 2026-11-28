// fixture.jsx as a native What file: signals for state, Headless UI tags as islands.
import { signal } from 'what-framework';
import {
  Combobox, ComboboxInput, ComboboxOption, ComboboxOptions,
  Dialog, DialogPanel, DialogTitle,
  Disclosure, DisclosureButton, DisclosurePanel,
  Listbox, ListboxButton, ListboxOption, ListboxOptions,
  Menu, MenuButton, MenuItem, MenuItems,
  Switch, Tab, TabGroup, TabList, TabPanel, TabPanels,
} from '@headlessui/react';

const people = ['Ada', 'Grace', 'Linus', 'Margaret'];

export default function Native() {
  const picked = signal('none');
  const on = signal(false);
  const person = signal(people[0]);
  const combo = signal(null);
  const query = signal('');
  const open = signal(false);
  const filtered = () => (query() === '' ? people : people.filter((p) => p.toLowerCase().includes(query().toLowerCase())));
  return (
    <div>
      <Menu>
        <MenuButton id="hm-button">Options</MenuButton>
        <MenuItems id="hm-items" anchor="bottom start">
          <MenuItem><button onClick={() => picked('edit')}>Edit</button></MenuItem>
          <MenuItem><button onClick={() => picked('delete')}>Delete</button></MenuItem>
        </MenuItems>
      </Menu>
      <span id="hm-picked">{picked()}</span>

      <Switch id="hs-switch" checked={on()} onChange={(next) => on(next)}>{on() ? 'on' : 'off'}</Switch>

      <Listbox value={person()} onChange={(next) => person(next)}>
        <ListboxButton id="hl-button">{person()}</ListboxButton>
        <ListboxOptions id="hl-options" anchor="bottom">
          {people.map((p) => <ListboxOption key={p} value={p}>{p}</ListboxOption>)}
        </ListboxOptions>
      </Listbox>
      <span id="hl-value">{person()}</span>

      <Combobox value={combo()} onChange={(next) => combo(next)} onClose={() => query('')}>
        <ComboboxInput id="hc-input" displayValue={(p) => p ?? ''} onChange={(e) => query(e.target.value)} />
        <ComboboxOptions id="hc-options" anchor="bottom">
          {filtered().map((p) => <ComboboxOption key={p} value={p}>{p}</ComboboxOption>)}
        </ComboboxOptions>
      </Combobox>
      <span id="hc-value">{String(combo())}</span>

      <button id="hd-open" onClick={() => open(true)}>Open dialog</button>
      <Dialog open={open()} onClose={() => open(false)}>
        <div style={{ position: 'fixed', inset: 0 }}>
          <DialogPanel id="hd-panel" style={{ margin: 40, background: 'white' }}>
            <DialogTitle>Payment</DialogTitle>
            <input id="hd-input" />
            <button id="hd-done" onClick={() => open(false)}>Done</button>
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
