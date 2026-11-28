import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Select from '@radix-ui/react-select';
import * as Tabs from '@radix-ui/react-tabs';

export default function Fixture() {
  const [picked, setPicked] = useState('none');
  const [bold, setBold] = useState(false);
  const [fruit, setFruit] = useState('apple');
  const [tab, setTab] = useState('one');
  return (
    <div>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger id="rm-trigger">Actions</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content id="rm-content">
            <DropdownMenu.Item onSelect={() => setPicked('copy')}>Copy</DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => setPicked('paste')}>Paste</DropdownMenu.Item>
            <DropdownMenu.Item disabled onSelect={() => setPicked('never')}>Disabled</DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.CheckboxItem id="rm-bold" checked={bold} onCheckedChange={setBold}>
              <DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator>Bold
            </DropdownMenu.CheckboxItem>
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger id="rm-sub">More</DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent>
                  <DropdownMenu.Item id="rm-deep" onSelect={() => setPicked('deep')}>Deep</DropdownMenu.Item>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <span id="rm-picked">{picked}</span>
      <span id="rm-bold-state">{String(bold)}</span>

      <Select.Root value={fruit} onValueChange={setFruit}>
        <Select.Trigger id="rs-trigger" aria-label="Fruit">
          <Select.Value />
          <Select.Icon>▾</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content id="rs-content" position="popper">
            <Select.Viewport>
              <Select.Item value="apple"><Select.ItemText>Apple</Select.ItemText></Select.Item>
              <Select.Item value="banana"><Select.ItemText>Banana</Select.ItemText></Select.Item>
              <Select.Item value="cherry"><Select.ItemText>Cherry</Select.ItemText></Select.Item>
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      <span id="rs-value">{fruit}</span>

      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List aria-label="Sections">
          <Tabs.Trigger id="tab-one" value="one">One</Tabs.Trigger>
          <Tabs.Trigger id="tab-two" value="two">Two</Tabs.Trigger>
          <Tabs.Trigger id="tab-three" value="three">Three</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="one"><p id="panel">Panel one</p></Tabs.Content>
        <Tabs.Content value="two"><p id="panel">Panel two</p></Tabs.Content>
        <Tabs.Content value="three"><p id="panel">Panel three</p></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
