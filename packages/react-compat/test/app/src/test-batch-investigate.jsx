/**
 * Batch test: Previously-investigating packages + react-beautiful-dnd
 */
import React, { useState } from 'react';

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

// 1. Recharts (was: render loop)
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
function T1() {
  const data = [
    { name: 'A', val: 10 }, { name: 'B', val: 20 },
    { name: 'C', val: 15 }, { name: 'D', val: 30 },
  ];
  return <div style={{ width: 280, height: 160 }}>
    <LineChart width={280} height={160} data={data}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="name" />
      <YAxis />
      <Line type="monotone" dataKey="val" stroke="#60a5fa" />
    </LineChart>
  </div>;
}

// 2. React Select (was: internal errors)
import Select from 'react-select';
function T2() {
  const [val, setVal] = useState(null);
  const options = [
    { value: 'a', label: 'Apple' },
    { value: 'b', label: 'Banana' },
    { value: 'c', label: 'Cherry' },
  ];
  return <div style={{ width: 250 }}>
    <Select value={val} onChange={setVal} options={options} menuPortalTarget={null}
      styles={{
        control: (base) => ({ ...base, background: '#222', borderColor: '#555' }),
        menu: (base) => ({ ...base, background: '#222' }),
        option: (base) => ({ ...base, background: '#222', color: '#fff' }),
        singleValue: (base) => ({ ...base, color: '#fff' }),
        input: (base) => ({ ...base, color: '#fff' }),
      }} />
  </div>;
}

// 3. React DatePicker (was: class inheritance)
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
function T3() {
  const [date, setDate] = useState(null);
  return <DatePicker selected={date} onChange={setDate} placeholderText="Select date..."
    className="dp-input" />;
}

// 4. react-beautiful-dnd
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
function T4() {
  const [items, setItems] = useState(['Item A', 'Item B', 'Item C']);
  const onDragEnd = (result) => {
    if (!result.destination) return;
    const arr = [...items];
    const [removed] = arr.splice(result.source.index, 1);
    arr.splice(result.destination.index, 0, removed);
    setItems(arr);
  };
  return <DragDropContext onDragEnd={onDragEnd}>
    <Droppable droppableId="list">
      {(provided) => (
        <div ref={provided.innerRef} {...provided.droppableProps}>
          {items.map((item, i) => (
            <Draggable key={item} draggableId={item} index={i}>
              {(prov) => (
                <div ref={prov.innerRef} {...prov.draggableProps} {...prov.dragHandleProps}
                  style={{ ...prov.draggableProps.style, padding: '4px 8px', margin: 2, background: '#333', borderRadius: 4 }}>
                  {item}
                </div>
              )}
            </Draggable>
          ))}
          {provided.placeholder}
        </div>
      )}
    </Droppable>
  </DragDropContext>;
}

export default function BatchInvestigate() {
  return (
    <div style={{ fontFamily: 'system-ui', color: '#eee', background: '#111', padding: 16, minHeight: '100vh' }}>
      <h1 style={{ fontSize: 24, marginBottom: 16, color: '#fbbf24' }}>Batch: Investigating Packages</h1>
      <TB name="Recharts"><T1 /></TB>
      <TB name="React Select"><T2 /></TB>
      <TB name="React DatePicker"><T3 /></TB>
      <TB name="react-beautiful-dnd"><T4 /></TB>
    </div>
  );
}
