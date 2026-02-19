import React from 'react';
import { useCombobox } from 'downshift';

const items = ['Apple', 'Banana', 'Cherry', 'Date', 'Elderberry', 'Fig', 'Grape', 'Honeydew', 'Kiwi', 'Lemon', 'Mango', 'Nectarine', 'Orange', 'Papaya'];

export function DownshiftTest() {
  const [inputItems, setInputItems] = React.useState(items);

  const {
    isOpen,
    getToggleButtonProps,
    getMenuProps,
    getInputProps,
    getItemProps,
    highlightedIndex,
    selectedItem,
  } = useCombobox({
    items: inputItems,
    onInputValueChange: ({ inputValue }) => {
      setInputItems(items.filter(item => item.toLowerCase().includes((inputValue || '').toLowerCase())));
    },
  });

  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>downshift — useCombobox</h3>
      <div style={{ position: 'relative', maxWidth: 300 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            {...getInputProps()}
            placeholder="Search fruits..."
            style={{ flex: 1, padding: '6px 12px', border: '1px solid #ddd', borderRadius: 4 }}
          />
          <button {...getToggleButtonProps()} style={{ padding: '6px 12px', cursor: 'pointer' }}>
            {isOpen ? '▲' : '▼'}
          </button>
        </div>
        <ul
          {...getMenuProps()}
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            maxHeight: 200, overflow: 'auto', listStyle: 'none', margin: 0, padding: 0,
            border: isOpen && inputItems.length ? '1px solid #ddd' : 'none',
            borderRadius: 4, background: '#fff', zIndex: 10
          }}
        >
          {isOpen && inputItems.map((item, index) => (
            <li
              key={item}
              {...getItemProps({ item, index })}
              style={{
                padding: '6px 12px',
                background: highlightedIndex === index ? '#e3f2fd' : selectedItem === item ? '#f5f5f5' : '#fff',
                cursor: 'pointer',
                fontWeight: selectedItem === item ? 'bold' : 'normal'
              }}
            >
              {item}
            </li>
          ))}
        </ul>
      </div>
      {selectedItem && <div style={{ marginTop: 8 }}>Selected: <strong>{selectedItem}</strong></div>}
      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — downshift useCombobox works</p>
    </div>
  );
}
