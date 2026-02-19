/**
 * Batch test: More packages — AG Grid, react-aria, more MUI, TanStack Router/Form, etc.
 */
import React, { useState, useRef, useEffect } from 'react';

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

// 1. AG Grid (was: portal system conflict)
import { AgGridReact } from 'ag-grid-react';
function T1() {
  const [rowData] = useState([
    { make: 'Toyota', model: 'Celica', price: 35000 },
    { make: 'Ford', model: 'Mondeo', price: 32000 },
    { make: 'Porsche', model: 'Boxster', price: 72000 },
  ]);
  const [colDefs] = useState([
    { field: 'make' }, { field: 'model' }, { field: 'price' },
  ]);
  return <div style={{ height: 200, width: 400 }} className="ag-theme-alpine">
    <AgGridReact rowData={rowData} columnDefs={colDefs} />
  </div>;
}

// 2. MUI TextField + Alert + more
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Badge from '@mui/material/Badge';
import LinearProgress from '@mui/material/LinearProgress';
function T2() {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 300 }}>
    <TextField label="Name" variant="outlined" size="small" />
    <Alert severity="success" variant="outlined">MUI Alert works</Alert>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Badge badgeContent={4} color="primary"><Avatar>W</Avatar></Badge>
      <span>Badge + Avatar</span>
    </div>
    <LinearProgress variant="determinate" value={60} />
  </div>;
}

// 3. MUI Icons
import HomeIcon from '@mui/icons-material/Home';
import SettingsIcon from '@mui/icons-material/Settings';
import SearchIcon from '@mui/icons-material/Search';
function T3() {
  return <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <HomeIcon style={{ color: '#60a5fa' }} />
    <SettingsIcon style={{ color: '#34d399' }} />
    <SearchIcon style={{ color: '#f472b6' }} />
    <span>3 MUI icons rendered</span>
  </div>;
}

// 4. lucide-react
import { Home, Settings, Search, Star, Heart } from 'lucide-react';
function T4() {
  return <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <Home size={20} color="#60a5fa" />
    <Settings size={20} color="#34d399" />
    <Search size={20} color="#f472b6" />
    <Star size={20} color="#fbbf24" />
    <Heart size={20} color="#f43f5e" />
    <span>5 Lucide icons</span>
  </div>;
}

// 5. react-dnd (separate from dnd-kit)
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
function DragItem({ text }) {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: 'ITEM', item: { text },
    collect: (m) => ({ isDragging: m.isDragging() }),
  }));
  return <div ref={drag} style={{ padding: '4px 12px', background: isDragging ? '#555' : '#333', borderRadius: 4, cursor: 'grab', opacity: isDragging ? 0.5 : 1 }}>
    {text}
  </div>;
}
function DropZone() {
  const [dropped, setDropped] = useState(null);
  const [, drop] = useDrop(() => ({
    accept: 'ITEM',
    drop: (item) => setDropped(item.text),
  }));
  return <div ref={drop} style={{ padding: 8, border: '1px dashed #666', borderRadius: 4, minHeight: 30 }}>
    {dropped ? `Dropped: ${dropped}` : 'Drop here'}
  </div>;
}
function T5() {
  return <DndProvider backend={HTML5Backend}>
    <div style={{ display: 'flex', gap: 8 }}>
      <DragItem text="Drag me" />
      <DropZone />
    </div>
  </DndProvider>;
}

// 6. @tanstack/react-form
import { useForm } from '@tanstack/react-form';
function T6() {
  const form = useForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value }) => { console.log('Form submitted:', value); },
  });
  return <div>
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}>
      <form.Field name="name" children={(field) => (
        <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)}
          placeholder="TanStack Form field" style={{ background: '#222', color: '#fff', border: '1px solid #555', padding: 4, borderRadius: 4 }} />
      )} />
      <button type="submit" style={{ marginLeft: 8 }}>Submit</button>
    </form>
  </div>;
}

// 7. react-resizable-panels
import { Group, Panel, Separator } from 'react-resizable-panels';
function T7() {
  return <Group direction="horizontal" style={{ height: 60 }}>
    <Panel defaultSize={50} minSize={20}>
      <div style={{ background: '#333', height: '100%', padding: 8 }}>Left</div>
    </Panel>
    <Separator style={{ width: 4, background: '#555' }} />
    <Panel defaultSize={50} minSize={20}>
      <div style={{ background: '#444', height: '100%', padding: 8 }}>Right</div>
    </Panel>
  </Group>;
}

// 8. react-json-view-lite
import { JsonView, darkStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
function T8() {
  return <JsonView data={{ framework: 'What', compat: true, count: 90 }} style={darkStyles} />;
}

// 9. input-otp
import { OTPInput } from 'input-otp';
function T9() {
  const [value, setValue] = useState('');
  return <OTPInput maxLength={4} value={value} onChange={setValue}
    render={({ slots }) => (
      <div style={{ display: 'flex', gap: 4 }}>
        {slots.map((slot, i) => (
          <div key={i} style={{ width: 32, height: 40, border: '1px solid #555', borderRadius: 4, background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18 }}>
            {slot.char || ''}
            {slot.hasFakeCaret && <span style={{ animation: 'blink 1s step-end infinite' }}>|</span>}
          </div>
        ))}
      </div>
    )} />;
}

// 10. classnames + clsx (pure utilities)
import clsx from 'clsx';
import classnames from 'classnames';
function T10() {
  const c1 = clsx('a', { b: true, c: false }, ['d']);
  const c2 = classnames('x', { y: true, z: false }, ['w']);
  return <div>clsx: "{c1}" | classnames: "{c2}"</div>;
}

export default function BatchMore() {
  return (
    <div style={{ fontFamily: 'system-ui', color: '#eee', background: '#111', padding: 16, minHeight: '100vh' }}>
      <h1 style={{ fontSize: 24, marginBottom: 16, color: '#60a5fa' }}>Batch: More Packages</h1>
      <TB name="AG Grid"><T1 /></TB>
      <TB name="@mui/material (extended)"><T2 /></TB>
      <TB name="@mui/icons-material"><T3 /></TB>
      <TB name="lucide-react"><T4 /></TB>
      <TB name="react-dnd"><T5 /></TB>
      <TB name="@tanstack/react-form"><T6 /></TB>
      <TB name="react-resizable-panels"><T7 /></TB>
      <TB name="react-json-view-lite"><T8 /></TB>
      <TB name="input-otp"><T9 /></TB>
      <TB name="classnames + clsx"><T10 /></TB>
    </div>
  );
}
