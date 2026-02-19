import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tabs from '@radix-ui/react-tabs';
import * as Checkbox from '@radix-ui/react-checkbox';
import * as Switch from '@radix-ui/react-switch';
import * as Avatar from '@radix-ui/react-avatar';

// NOTE: @radix-ui/react-select causes infinite hang — under investigation

function RadixDialog() {
  return (
    <Dialog.Root>
      <Dialog.Trigger style={{ padding: '4px 10px' }}>Dialog</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
        <Dialog.Content style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          background: 'white', borderRadius: '8px', padding: '24px', minWidth: '300px', color: '#333'
        }}>
          <Dialog.Title>Radix Dialog</Dialog.Title>
          <Dialog.Description style={{ color: '#666' }}>From @radix-ui/react-dialog</Dialog.Description>
          <Dialog.Close style={{ marginTop: '12px', padding: '4px 10px' }}>Close</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RadixPopover() {
  return (
    <Popover.Root>
      <Popover.Trigger style={{ padding: '4px 10px' }}>Popover</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content style={{
          background: 'white', borderRadius: '8px', padding: '12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', color: '#333'
        }} sideOffset={5}>
          Popover content
          <Popover.Arrow style={{ fill: 'white' }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function RadixTooltip() {
  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger style={{ padding: '4px 10px' }}>Hover me</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content style={{
            background: '#1e293b', color: 'white', borderRadius: '4px',
            padding: '4px 8px', fontSize: '13px'
          }} sideOffset={5}>
            Tooltip from Radix
            <Tooltip.Arrow style={{ fill: '#1e293b' }} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

function RadixDropdown() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger style={{ padding: '4px 10px' }}>Menu</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content style={{
          background: 'white', borderRadius: '6px', padding: '4px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', minWidth: '120px'
        }} sideOffset={5}>
          <DropdownMenu.Item style={{ padding: '4px 8px', borderRadius: '4px', color: '#333', cursor: 'pointer' }}>Edit</DropdownMenu.Item>
          <DropdownMenu.Item style={{ padding: '4px 8px', borderRadius: '4px', color: '#333', cursor: 'pointer' }}>Duplicate</DropdownMenu.Item>
          <DropdownMenu.Separator style={{ height: '1px', background: '#eee', margin: '4px 0' }} />
          <DropdownMenu.Item style={{ padding: '4px 8px', borderRadius: '4px', color: 'red', cursor: 'pointer' }}>Delete</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function RadixTabs() {
  return (
    <Tabs.Root defaultValue="tab1" style={{ maxWidth: '300px' }}>
      <Tabs.List style={{ display: 'flex', gap: '4px', borderBottom: '1px solid #ddd' }}>
        <Tabs.Trigger value="tab1" style={{ padding: '4px 12px', cursor: 'pointer' }}>Account</Tabs.Trigger>
        <Tabs.Trigger value="tab2" style={{ padding: '4px 12px', cursor: 'pointer' }}>Settings</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="tab1" style={{ padding: '8px 0' }}>Account settings panel</Tabs.Content>
      <Tabs.Content value="tab2" style={{ padding: '8px 0' }}>App settings panel</Tabs.Content>
    </Tabs.Root>
  );
}

function RadixCheckboxAndSwitch() {
  const [checked, setChecked] = useState(false);
  const [switchOn, setSwitchOn] = useState(false);
  return (
    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Checkbox.Root
          checked={checked}
          onCheckedChange={setChecked}
          style={{
            width: '20px', height: '20px', borderRadius: '4px',
            border: '2px solid #666', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: checked ? '#3b82f6' : 'transparent'
          }}
        >
          <Checkbox.Indicator>{checked && '✓'}</Checkbox.Indicator>
        </Checkbox.Root>
        Checkbox
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Switch.Root
          checked={switchOn}
          onCheckedChange={setSwitchOn}
          style={{
            width: '40px', height: '22px', borderRadius: '11px',
            background: switchOn ? '#3b82f6' : '#ccc', position: 'relative', cursor: 'pointer',
            border: 'none'
          }}
        >
          <Switch.Thumb style={{
            display: 'block', width: '18px', height: '18px', borderRadius: '50%',
            background: 'white', transition: 'transform 0.1s',
            transform: switchOn ? 'translateX(20px)' : 'translateX(2px)',
            marginTop: '2px'
          }} />
        </Switch.Root>
        Switch
      </label>
    </div>
  );
}

function RadixAvatar() {
  return (
    <div style={{ display: 'flex', gap: '8px' }}>
      <Avatar.Root style={{ width: '40px', height: '40px', borderRadius: '50%', overflow: 'hidden', background: '#ddd' }}>
        <Avatar.Image src="https://i.pravatar.cc/40?1" alt="User" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <Avatar.Fallback delayMs={600} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: '#3b82f6', color: 'white', fontSize: '14px' }}>AB</Avatar.Fallback>
      </Avatar.Root>
      <Avatar.Root style={{ width: '40px', height: '40px', borderRadius: '50%', overflow: 'hidden', background: '#ddd' }}>
        <Avatar.Fallback style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: '#a855f7', color: 'white', fontSize: '14px' }}>CD</Avatar.Fallback>
      </Avatar.Root>
    </div>
  );
}

export function RadixSuiteTest() {
  return (
    <div>
      <p style={{ fontWeight: 'bold', marginBottom: '8px' }}>8 Radix UI primitives:</p>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <RadixDialog />
        <RadixPopover />
        <RadixTooltip />
        <RadixDropdown />
      </div>
      <div style={{ marginBottom: '12px' }}><RadixTabs /></div>
      <div style={{ marginBottom: '12px' }}><RadixCheckboxAndSwitch /></div>
      <div style={{ marginBottom: '12px' }}><RadixAvatar /></div>
      <p style={{ color: 'green' }}>8 Radix UI primitives: Dialog, Popover, Tooltip, DropdownMenu, Tabs, Checkbox, Switch, Avatar</p>
    </div>
  );
}
