/**
 * Mega-batch test — tests ALL expected & new packages in one page.
 * Each test is wrapped in an ErrorBoundary to isolate failures.
 */
import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';

// ── Error Boundary ──
class TestBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) return (
      <div style={{ border: '2px solid #f44', borderRadius: 8, padding: 12, margin: 8, background: '#2a0a0a' }}>
        <b style={{ color: '#f66' }}>FAIL: {this.props.name}</b>
        <pre style={{ color: '#f88', fontSize: 11, marginTop: 4 }}>{this.state.error.message}</pre>
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

// ═══════════════════════════════════════
// ICON LIBRARIES
// ═══════════════════════════════════════

// 1. @heroicons/react
import { BeakerIcon, ArrowRightIcon, HomeIcon } from '@heroicons/react/24/solid';
function TestHeroicons() {
  return <div style={{ display: 'flex', gap: 8 }}>
    <BeakerIcon style={{ width: 24, height: 24, color: '#60a5fa' }} />
    <ArrowRightIcon style={{ width: 24, height: 24, color: '#34d399' }} />
    <HomeIcon style={{ width: 24, height: 24, color: '#f472b6' }} />
    <span>3 Heroicons rendered</span>
  </div>;
}

// 2. @phosphor-icons/react
import { Lightning, Heart, Star } from '@phosphor-icons/react';
function TestPhosphor() {
  return <div style={{ display: 'flex', gap: 8 }}>
    <Lightning size={24} color="#fbbf24" weight="fill" />
    <Heart size={24} color="#f43f5e" weight="fill" />
    <Star size={24} color="#a78bfa" weight="fill" />
    <span>3 Phosphor icons rendered</span>
  </div>;
}

// 3. @radix-ui/react-icons
import { FaceIcon, GearIcon, RocketIcon } from '@radix-ui/react-icons';
function TestRadixIcons() {
  return <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <FaceIcon width={20} height={20} />
    <GearIcon width={20} height={20} />
    <RocketIcon width={20} height={20} />
    <span>3 Radix icons rendered</span>
  </div>;
}

// ═══════════════════════════════════════
// ALREADY-INSTALLED EXPECTED PACKAGES
// ═══════════════════════════════════════

// 4. react-intersection-observer
import { useInView } from 'react-intersection-observer';
function TestIntersectionObserver() {
  const { ref, inView } = useInView({ threshold: 0 });
  return <div ref={ref}>InView: {inView ? 'YES' : 'NO'} (hook works)</div>;
}

// 5. react-error-boundary (test that the component itself works)
import { ErrorBoundary as REB } from 'react-error-boundary';
function TestREBoundary() {
  return <REB fallback={<div>Fallback</div>}>
    <div>react-error-boundary wrapping works</div>
  </REB>;
}

// 6. valtio
import { proxy, useSnapshot } from 'valtio';
const valtioState = proxy({ count: 0 });
function TestValtio() {
  const snap = useSnapshot(valtioState);
  return <div>
    <span>Valtio count: {snap.count}</span>
    <button onClick={() => { valtioState.count++; }} style={{ marginLeft: 8 }}>+1</button>
  </div>;
}

// 7. downshift
import { useCombobox } from 'downshift';
function TestDownshift() {
  const items = ['Apple', 'Banana', 'Cherry'];
  const { isOpen, getMenuProps, getInputProps, getItemProps } = useCombobox({
    items,
    onInputValueChange: () => {},
  });
  return <div>
    <input {...getInputProps()} placeholder="Type fruit..." style={{ background: '#222', color: '#fff', border: '1px solid #555', padding: 4, borderRadius: 4 }} />
    <ul {...getMenuProps()} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {isOpen && items.map((item, i) => (
        <li key={i} {...getItemProps({ item, index: i })}>{item}</li>
      ))}
    </ul>
    <span>Downshift combobox mounted</span>
  </div>;
}

// 8. react-modal
import Modal from 'react-modal';
function TestReactModal() {
  const [open, setOpen] = useState(false);
  return <div>
    <button onClick={() => setOpen(true)}>Open Modal</button>
    <Modal
      isOpen={open}
      onRequestClose={() => setOpen(false)}
      style={{ overlay: { background: 'rgba(0,0,0,0.5)' }, content: { background: '#222', color: '#fff', border: '1px solid #555' } }}
      ariaHideApp={false}
    >
      <h3>Modal Content</h3>
      <button onClick={() => setOpen(false)}>Close</button>
    </Modal>
    <span style={{ marginLeft: 8 }}>react-modal mounted</span>
  </div>;
}

// 9. react-paginate
import ReactPaginate from 'react-paginate';
function TestPaginate() {
  const [page, setPage] = useState(0);
  return <div>
    <ReactPaginate
      pageCount={10}
      pageRangeDisplayed={3}
      marginPagesDisplayed={1}
      onPageChange={({ selected }) => setPage(selected)}
      containerClassName="paginate"
      activeClassName="active"
    />
    <span>Page: {page}</span>
  </div>;
}

// 10. react-virtuoso
import { Virtuoso } from 'react-virtuoso';
function TestVirtuoso() {
  return <div style={{ height: 120 }}>
    <Virtuoso
      totalCount={200}
      itemContent={(i) => <div style={{ padding: '4px 8px', borderBottom: '1px solid #333' }}>Item {i}</div>}
      style={{ height: '100%' }}
    />
  </div>;
}

// 11. react-hotkeys-hook
import { useHotkeys } from 'react-hotkeys-hook';
function TestHotkeys() {
  const [pressed, setPressed] = useState('none');
  useHotkeys('ctrl+k', () => setPressed('ctrl+k'), { preventDefault: true });
  return <div>Last hotkey: {pressed} (press Ctrl+K)</div>;
}

// 12. use-debounce
import { useDebouncedCallback } from 'use-debounce';
function TestUseDebounce() {
  const [val, setVal] = useState('');
  const [debounced, setDebounced] = useState('');
  const debouncedCb = useDebouncedCallback((v) => setDebounced(v), 300);
  return <div>
    <input value={val} onChange={(e) => { setVal(e.target.value); debouncedCb(e.target.value); }}
      placeholder="Type..." style={{ background: '#222', color: '#fff', border: '1px solid #555', padding: 4, borderRadius: 4 }} />
    <span style={{ marginLeft: 8 }}>Debounced: "{debounced}"</span>
  </div>;
}

// 13. react-responsive
import { useMediaQuery } from 'react-responsive';
function TestResponsive() {
  const isDesktop = useMediaQuery({ minWidth: 768 });
  return <div>Is desktop (≥768px): {isDesktop ? 'YES' : 'NO'}</div>;
}

// 14. @uidotdev/usehooks
import { useToggle } from '@uidotdev/usehooks';
function TestUidotdevHooks() {
  const [on, toggle] = useToggle(false);
  return <div>
    <span>Toggle: {on ? 'ON' : 'OFF'}</span>
    <button onClick={toggle} style={{ marginLeft: 8 }}>Toggle</button>
  </div>;
}

// 15. react-loading-skeleton
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
function TestSkeleton() {
  return <div style={{ width: 200 }}>
    <Skeleton count={3} />
    <span>Skeleton rendered</span>
  </div>;
}

// 16. react-spinners
import { ClipLoader, BeatLoader, PulseLoader } from 'react-spinners';
function TestSpinners() {
  return <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <ClipLoader size={20} color="#60a5fa" />
    <BeatLoader size={8} color="#34d399" />
    <PulseLoader size={8} color="#f472b6" />
    <span>3 spinners rendered</span>
  </div>;
}

// 17. react-textarea-autosize
import TextareaAutosize from 'react-textarea-autosize';
function TestTextareaAutosize() {
  return <TextareaAutosize
    minRows={2}
    maxRows={5}
    placeholder="Auto-resizing textarea..."
    style={{ background: '#222', color: '#fff', border: '1px solid #555', padding: 8, borderRadius: 4, width: 300 }}
  />;
}

// 18. react-countup
import CountUp from 'react-countup';
function TestCountUp() {
  return <div>Count: <CountUp end={1000} duration={1} /></div>;
}

// 19. usehooks-ts
import { useLocalStorage, useBoolean } from 'usehooks-ts';
function TestUsehooksTs() {
  const { value, setTrue, setFalse } = useBoolean(false);
  return <div>
    <span>Boolean: {value ? 'true' : 'false'}</span>
    <button onClick={setTrue} style={{ marginLeft: 8 }}>True</button>
    <button onClick={setFalse} style={{ marginLeft: 8 }}>False</button>
  </div>;
}

// 20. react-use
import { useToggle as useToggleRU, useMouse } from 'react-use';
function TestReactUse() {
  const [on, toggle] = useToggleRU(false);
  return <div>
    <span>react-use toggle: {on ? 'ON' : 'OFF'}</span>
    <button onClick={toggle} style={{ marginLeft: 8 }}>Toggle</button>
  </div>;
}

// ═══════════════════════════════════════
// NEW PACKAGES
// ═══════════════════════════════════════

// 21. react-tabs
import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';
function TestReactTabs() {
  return <Tabs>
    <TabList style={{ display: 'flex', gap: 4, listStyle: 'none', padding: 0, margin: 0 }}>
      <Tab style={{ padding: '4px 12px', cursor: 'pointer', borderRadius: 4, background: '#333' }}>Tab 1</Tab>
      <Tab style={{ padding: '4px 12px', cursor: 'pointer', borderRadius: 4, background: '#333' }}>Tab 2</Tab>
    </TabList>
    <TabPanel><p>Content 1</p></TabPanel>
    <TabPanel><p>Content 2</p></TabPanel>
  </Tabs>;
}

// 22. react-beautiful-dnd
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
function TestBeautifulDnd() {
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

// 23. react-slick
import Slider from 'react-slick';
function TestReactSlick() {
  return <div style={{ width: 200 }}>
    <Slider dots={true} slidesToShow={1} slidesToScroll={1}>
      <div><div style={{ background: '#333', padding: 12, textAlign: 'center' }}>Slide 1</div></div>
      <div><div style={{ background: '#444', padding: 12, textAlign: 'center' }}>Slide 2</div></div>
      <div><div style={{ background: '#555', padding: 12, textAlign: 'center' }}>Slide 3</div></div>
    </Slider>
  </div>;
}

// 24. react-qr-code
import QRCode from 'react-qr-code';
function TestQRCode() {
  return <div style={{ background: '#fff', padding: 8, display: 'inline-block', borderRadius: 4 }}>
    <QRCode value="https://github.com/zvndev/what-fw" size={80} />
  </div>;
}

// 25. react-fast-marquee
import Marquee from 'react-fast-marquee';
function TestMarquee() {
  return <Marquee speed={50} style={{ maxWidth: 300 }}>
    <span style={{ marginRight: 40 }}>What Framework</span>
    <span style={{ marginRight: 40 }}>React Compat</span>
    <span style={{ marginRight: 40 }}>Signals Engine</span>
  </Marquee>;
}

// 26. react-type-animation
import { TypeAnimation } from 'react-type-animation';
function TestTypeAnimation() {
  return <TypeAnimation
    sequence={['Hello World', 1000, 'What Framework', 1000]}
    wrapper="span"
    speed={50}
    repeat={Infinity}
  />;
}

// 27. react-confetti
import Confetti from 'react-confetti';
function TestConfetti() {
  return <div style={{ position: 'relative', width: 200, height: 100, overflow: 'hidden' }}>
    <Confetti width={200} height={100} numberOfPieces={20} recycle={false} />
    <span>Confetti rendered</span>
  </div>;
}

// 28. react-scroll
import { Link as ScrollLink, Element as ScrollElement } from 'react-scroll';
function TestReactScroll() {
  return <div>
    <ScrollLink to="target" smooth={true} duration={200} style={{ cursor: 'pointer', color: '#60a5fa' }}>
      Scroll to target
    </ScrollLink>
    <ScrollElement name="target" style={{ marginTop: 8 }}>Target element</ScrollElement>
  </div>;
}

// 29. react-chartjs-2
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title } from 'chart.js';
ChartJS.register(CategoryScale, LinearScale, BarElement, Title);
function TestChartjs() {
  const data = {
    labels: ['Jan', 'Feb', 'Mar'],
    datasets: [{ label: 'Revenue', data: [10, 20, 30], backgroundColor: '#60a5fa' }],
  };
  return <div style={{ width: 250, height: 150 }}>
    <Bar data={data} options={{ responsive: true, maintainAspectRatio: false }} />
  </div>;
}

// 30. @mui/material
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Switch from '@mui/material/Switch';
function TestMUI() {
  const [checked, setChecked] = useState(false);
  return <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <Button variant="contained" size="small">MUI Button</Button>
    <Chip label="MUI Chip" size="small" color="primary" />
    <Switch checked={checked} onChange={() => setChecked(!checked)} size="small" />
    <span>MUI works</span>
  </div>;
}

// ═══════════════════════════════════════
// INVESTIGATING FIXES
// ═══════════════════════════════════════

// 31. Recharts (was: render loop)
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
function TestRecharts() {
  const data = [
    { name: 'A', val: 10 }, { name: 'B', val: 20 },
    { name: 'C', val: 15 }, { name: 'D', val: 30 },
  ];
  return <div style={{ width: 250, height: 150 }}>
    <LineChart width={250} height={150} data={data}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="name" />
      <YAxis />
      <Line type="monotone" dataKey="val" stroke="#60a5fa" />
    </LineChart>
  </div>;
}

// 32. React Select (was: internal errors)
import Select from 'react-select';
function TestReactSelect() {
  const [val, setVal] = useState(null);
  const options = [
    { value: 'a', label: 'Apple' },
    { value: 'b', label: 'Banana' },
    { value: 'c', label: 'Cherry' },
  ];
  return <div style={{ width: 250 }}>
    <Select
      value={val}
      onChange={setVal}
      options={options}
      menuPortalTarget={null}
      styles={{
        control: (base) => ({ ...base, background: '#222', borderColor: '#555' }),
        menu: (base) => ({ ...base, background: '#222' }),
        option: (base) => ({ ...base, background: '#222', color: '#fff' }),
        singleValue: (base) => ({ ...base, color: '#fff' }),
        input: (base) => ({ ...base, color: '#fff' }),
      }}
    />
  </div>;
}

// 33. React DatePicker (was: class inheritance)
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
function TestDatePicker() {
  const [date, setDate] = useState(null);
  return <DatePicker
    selected={date}
    onChange={setDate}
    placeholderText="Select date..."
    className="dp-input"
  />;
}

// ═══════════════════════════════════════
// APP
// ═══════════════════════════════════════
export default function MegaBatch() {
  return (
    <div style={{ fontFamily: 'system-ui', color: '#eee', background: '#111', padding: 16, minHeight: '100vh' }}>
      <h1 style={{ fontSize: 24, marginBottom: 16, color: '#60a5fa' }}>React Compat — Mega Batch Test</h1>
      <p style={{ color: '#888', marginBottom: 16 }}>Testing {33} packages in one page. Green = PASS, Red = FAIL.</p>

      <h2 style={{ fontSize: 18, color: '#34d399', marginTop: 24 }}>Icon Libraries</h2>
      <TestBoundary name="@heroicons/react"><TestHeroicons /></TestBoundary>
      <TestBoundary name="@phosphor-icons/react"><TestPhosphor /></TestBoundary>
      <TestBoundary name="@radix-ui/react-icons"><TestRadixIcons /></TestBoundary>

      <h2 style={{ fontSize: 18, color: '#34d399', marginTop: 24 }}>Expected Packages (hooks/components)</h2>
      <TestBoundary name="react-intersection-observer"><TestIntersectionObserver /></TestBoundary>
      <TestBoundary name="react-error-boundary"><TestREBoundary /></TestBoundary>
      <TestBoundary name="valtio"><TestValtio /></TestBoundary>
      <TestBoundary name="downshift"><TestDownshift /></TestBoundary>
      <TestBoundary name="react-modal"><TestReactModal /></TestBoundary>
      <TestBoundary name="react-paginate"><TestPaginate /></TestBoundary>
      <TestBoundary name="react-virtuoso"><TestVirtuoso /></TestBoundary>
      <TestBoundary name="react-hotkeys-hook"><TestHotkeys /></TestBoundary>
      <TestBoundary name="use-debounce"><TestUseDebounce /></TestBoundary>
      <TestBoundary name="react-responsive"><TestResponsive /></TestBoundary>
      <TestBoundary name="@uidotdev/usehooks"><TestUidotdevHooks /></TestBoundary>
      <TestBoundary name="react-loading-skeleton"><TestSkeleton /></TestBoundary>
      <TestBoundary name="react-spinners"><TestSpinners /></TestBoundary>
      <TestBoundary name="react-textarea-autosize"><TestTextareaAutosize /></TestBoundary>
      <TestBoundary name="react-countup"><TestCountUp /></TestBoundary>
      <TestBoundary name="usehooks-ts"><TestUsehooksTs /></TestBoundary>
      <TestBoundary name="react-use"><TestReactUse /></TestBoundary>

      <h2 style={{ fontSize: 18, color: '#34d399', marginTop: 24 }}>New Packages</h2>
      <TestBoundary name="react-tabs"><TestReactTabs /></TestBoundary>
      <TestBoundary name="react-beautiful-dnd"><TestBeautifulDnd /></TestBoundary>
      <TestBoundary name="react-slick"><TestReactSlick /></TestBoundary>
      <TestBoundary name="react-qr-code"><TestQRCode /></TestBoundary>
      <TestBoundary name="react-fast-marquee"><TestMarquee /></TestBoundary>
      <TestBoundary name="react-type-animation"><TestTypeAnimation /></TestBoundary>
      <TestBoundary name="react-confetti"><TestConfetti /></TestBoundary>
      <TestBoundary name="react-scroll"><TestReactScroll /></TestBoundary>
      <TestBoundary name="react-chartjs-2"><TestChartjs /></TestBoundary>
      <TestBoundary name="@mui/material"><TestMUI /></TestBoundary>

      <h2 style={{ fontSize: 18, color: '#fbbf24', marginTop: 24 }}>Investigating Packages (fix attempts)</h2>
      <TestBoundary name="Recharts"><TestRecharts /></TestBoundary>
      <TestBoundary name="React Select"><TestReactSelect /></TestBoundary>
      <TestBoundary name="React DatePicker"><TestDatePicker /></TestBoundary>
    </div>
  );
}
