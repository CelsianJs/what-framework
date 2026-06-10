import { useState } from 'react';
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/react';

export function MenuSection() {
  const [picked, setPicked] = useState('none');
  return (
    <section id="menu-section">
      <h2>6. @headlessui/react Menu</h2>
      <Menu>
        <MenuButton id="m-button">Options</MenuButton>
        <MenuItems id="m-items">
          <MenuItem>
            <button className="m-item" onClick={() => setPicked('account')}>Account</button>
          </MenuItem>
          <MenuItem>
            <button className="m-item" onClick={() => setPicked('settings')}>Settings</button>
          </MenuItem>
        </MenuItems>
      </Menu>
      <div>picked: <output id="m-picked">{picked}</output></div>
    </section>
  );
}
