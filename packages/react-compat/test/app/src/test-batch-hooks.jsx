/**
 * Batch test: Hook-based utility libraries
 */
import React, { useState, useEffect, useRef } from 'react';

class TB extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) return (
      <div style={{ border: '2px solid #f44', borderRadius: 8, padding: 12, margin: 8, background: '#2a0a0a' }}>
        <b style={{ color: '#f66' }}>FAIL: {this.props.name}</b>
        <pre style={{ color: '#f88', fontSize: 11, marginTop: 4, whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
      </div>
    );
    return (
      <div style={{ border: '2px solid #4f4', borderRadius: 8, padding: 12, margin: 8, background: '#0a2a0a' }}>
        <b style={{ color: '#4f4' }}>PASS: {this.props.name}</b>
        <div style={{ marginTop: 8 }}>{this.props.children}</div>
      </div>
    );
  }
}

// 1. valtio
import { proxy, useSnapshot } from 'valtio';
const vState = proxy({ count: 0 });
function T1() {
  const snap = useSnapshot(vState);
  return <div><span>Valtio count: {snap.count}</span><button onClick={() => { vState.count++; }} style={{ marginLeft: 8 }}>+1</button></div>;
}

// 2. react-hotkeys-hook
import { useHotkeys } from 'react-hotkeys-hook';
function T2() {
  const [pressed, setPressed] = useState('none');
  useHotkeys('ctrl+k', () => setPressed('ctrl+k'), { preventDefault: true });
  return <div>Last hotkey: {pressed} (press Ctrl+K)</div>;
}

// 3. use-debounce
import { useDebouncedCallback } from 'use-debounce';
function T3() {
  const [val, setVal] = useState('');
  const [debounced, setDebounced] = useState('');
  const debouncedCb = useDebouncedCallback((v) => setDebounced(v), 300);
  return <div>
    <input value={val} onChange={(e) => { setVal(e.target.value); debouncedCb(e.target.value); }}
      placeholder="Type..." style={{ background: '#222', color: '#fff', border: '1px solid #555', padding: 4, borderRadius: 4 }} />
    <span style={{ marginLeft: 8 }}>Debounced: "{debounced}"</span>
  </div>;
}

// 4. @uidotdev/usehooks
import { useToggle } from '@uidotdev/usehooks';
function T4() {
  const [on, toggle] = useToggle(false);
  return <div><span>Toggle: {on ? 'ON' : 'OFF'}</span><button onClick={toggle} style={{ marginLeft: 8 }}>Toggle</button></div>;
}

// 5. usehooks-ts
import { useBoolean } from 'usehooks-ts';
function T5() {
  const { value, setTrue, setFalse } = useBoolean(false);
  return <div>
    <span>Boolean: {value ? 'true' : 'false'}</span>
    <button onClick={setTrue} style={{ marginLeft: 8 }}>True</button>
    <button onClick={setFalse} style={{ marginLeft: 8 }}>False</button>
  </div>;
}

// 6. react-use
import { useToggle as useToggleRU } from 'react-use';
function T6() {
  const [on, toggle] = useToggleRU(false);
  return <div><span>react-use toggle: {on ? 'ON' : 'OFF'}</span><button onClick={toggle} style={{ marginLeft: 8 }}>Toggle</button></div>;
}

// 7. react-textarea-autosize
import TextareaAutosize from 'react-textarea-autosize';
function T7() {
  return <TextareaAutosize minRows={2} maxRows={5} placeholder="Auto-resizing textarea..."
    style={{ background: '#222', color: '#fff', border: '1px solid #555', padding: 8, borderRadius: 4, width: 300 }} />;
}

// 8. downshift
import { useCombobox } from 'downshift';
function T8() {
  const items = ['Apple', 'Banana', 'Cherry'];
  const { isOpen, getMenuProps, getInputProps, getItemProps } = useCombobox({ items, onInputValueChange: () => {} });
  return <div>
    <input {...getInputProps()} placeholder="Type fruit..." style={{ background: '#222', color: '#fff', border: '1px solid #555', padding: 4, borderRadius: 4 }} />
    <ul {...getMenuProps()} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {isOpen && items.map((item, i) => <li key={i} {...getItemProps({ item, index: i })}>{item}</li>)}
    </ul>
  </div>;
}

// 9. react-modal
import Modal from 'react-modal';
function T9() {
  const [open, setOpen] = useState(false);
  return <div>
    <button onClick={() => setOpen(true)}>Open Modal</button>
    <Modal isOpen={open} onRequestClose={() => setOpen(false)}
      style={{ overlay: { background: 'rgba(0,0,0,0.5)' }, content: { background: '#222', color: '#fff' } }}
      ariaHideApp={false}>
      <h3>Modal Content</h3><button onClick={() => setOpen(false)}>Close</button>
    </Modal>
    <span style={{ marginLeft: 8 }}>react-modal mounted</span>
  </div>;
}

// 10. react-paginate
import ReactPaginate from 'react-paginate';
function T10() {
  const [page, setPage] = useState(0);
  return <div>
    <ReactPaginate pageCount={10} pageRangeDisplayed={3} marginPagesDisplayed={1}
      onPageChange={({ selected }) => setPage(selected)} containerClassName="paginate" />
    <span>Page: {page}</span>
  </div>;
}

export default function BatchHooks() {
  return (
    <div style={{ fontFamily: 'system-ui', color: '#eee', background: '#111', padding: 16, minHeight: '100vh' }}>
      <h1 style={{ fontSize: 24, marginBottom: 16, color: '#60a5fa' }}>Batch: Hooks & Utilities</h1>
      <TB name="valtio"><T1 /></TB>
      <TB name="react-hotkeys-hook"><T2 /></TB>
      <TB name="use-debounce"><T3 /></TB>
      <TB name="@uidotdev/usehooks"><T4 /></TB>
      <TB name="usehooks-ts"><T5 /></TB>
      <TB name="react-use"><T6 /></TB>
      <TB name="react-textarea-autosize"><T7 /></TB>
      <TB name="downshift"><T8 /></TB>
      <TB name="react-modal"><T9 /></TB>
      <TB name="react-paginate"><T10 /></TB>
    </div>
  );
}
