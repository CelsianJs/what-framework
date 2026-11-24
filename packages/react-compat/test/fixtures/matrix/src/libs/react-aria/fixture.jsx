import { useState } from 'react';
import {
  Button, Checkbox, ComboBox, Dialog, DialogTrigger, Heading, Input, Label, ListBox, ListBoxItem, Modal, Popover,
  Select, SelectValue, Switch, Tab, TabList, TabPanel, Tabs, TextField,
} from 'react-aria-components';

export default function Fixture() {
  const [presses, setPresses] = useState(0);
  const [name, setName] = useState('');
  const [animal, setAnimal] = useState('cat');
  const [fruit, setFruit] = useState(null);
  const [agree, setAgree] = useState(false);
  const [on, setOn] = useState(false);
  return (
    <div>
      <Button id="ra-btn" onPress={() => setPresses((n) => n + 1)}>Pressed {presses}</Button>

      <TextField value={name} onChange={setName}>
        <Label>Name</Label>
        <Input id="ra-input" />
      </TextField>
      <span id="ra-echo">{name}</span>

      <Select selectedKey={animal} onSelectionChange={setAnimal} aria-label="Animal">
        <Button id="ra-select"><SelectValue /></Button>
        <Popover>
          <ListBox id="ra-listbox">
            <ListBoxItem id="cat">Cat</ListBoxItem>
            <ListBoxItem id="dog">Dog</ListBoxItem>
            <ListBoxItem id="owl">Owl</ListBoxItem>
          </ListBox>
        </Popover>
      </Select>
      <span id="ra-animal">{animal}</span>

      <ComboBox selectedKey={fruit} onSelectionChange={setFruit} aria-label="Fruit">
        <Input id="ra-combo" />
        <Button id="ra-combo-btn">▾</Button>
        <Popover>
          <ListBox>
            <ListBoxItem id="apple">Apple</ListBoxItem>
            <ListBoxItem id="apricot">Apricot</ListBoxItem>
            <ListBoxItem id="banana">Banana</ListBoxItem>
          </ListBox>
        </Popover>
      </ComboBox>
      <span id="ra-fruit">{String(fruit)}</span>

      <DialogTrigger>
        <Button id="ra-open">Open</Button>
        <Modal isDismissable>
          <Dialog id="ra-dialog">
            {({ close }) => (
              <>
                <Heading slot="title">Sign up</Heading>
                <TextField autoFocus>
                  <Label>Email</Label>
                  <Input id="ra-email" />
                </TextField>
                <Button id="ra-close" onPress={close}>Close</Button>
              </>
            )}
          </Dialog>
        </Modal>
      </DialogTrigger>

      <div style={{ padding: 12 }}>
        <Checkbox id="ra-check" isSelected={agree} onChange={setAgree}>Agree</Checkbox>
        <span id="ra-agree">{String(agree)}</span>
      </div>
      <div style={{ padding: 12 }}>
        <Switch id="ra-switch" isSelected={on} onChange={setOn}>Wifi</Switch>
        <span id="ra-on">{String(on)}</span>
      </div>

      <Tabs>
        <TabList aria-label="Sections">
          <Tab id="one">One</Tab>
          <Tab id="two">Two</Tab>
        </TabList>
        <TabPanel id="one"><p id="ra-panel">panel one</p></TabPanel>
        <TabPanel id="two"><p id="ra-panel">panel two</p></TabPanel>
      </Tabs>
    </div>
  );
}
