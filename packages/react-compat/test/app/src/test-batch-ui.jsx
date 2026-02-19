/**
 * Batch test: UI component libraries + animation + charts
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

// 1. react-tabs
import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';
function T1() {
  return <Tabs>
    <TabList style={{ display: 'flex', gap: 4, listStyle: 'none', padding: 0, margin: 0 }}>
      <Tab style={{ padding: '4px 12px', cursor: 'pointer', borderRadius: 4, background: '#333' }}>Tab 1</Tab>
      <Tab style={{ padding: '4px 12px', cursor: 'pointer', borderRadius: 4, background: '#333' }}>Tab 2</Tab>
    </TabList>
    <TabPanel><p>Content 1</p></TabPanel>
    <TabPanel><p>Content 2</p></TabPanel>
  </Tabs>;
}

// 2. react-virtuoso
import { Virtuoso } from 'react-virtuoso';
function T2() {
  return <div style={{ height: 120 }}>
    <Virtuoso totalCount={200} itemContent={(i) => <div style={{ padding: '4px 8px', borderBottom: '1px solid #333' }}>Item {i}</div>}
      style={{ height: '100%' }} />
  </div>;
}

// 3. react-fast-marquee
import Marquee from 'react-fast-marquee';
function T3() {
  return <Marquee speed={50} style={{ maxWidth: 300 }}>
    <span style={{ marginRight: 40 }}>What Framework</span>
    <span style={{ marginRight: 40 }}>React Compat</span>
    <span style={{ marginRight: 40 }}>Signals Engine</span>
  </Marquee>;
}

// 4. react-type-animation
import { TypeAnimation } from 'react-type-animation';
function T4() {
  return <TypeAnimation sequence={['Hello World', 1000, 'What Framework', 1000]} wrapper="span" speed={50} repeat={Infinity} />;
}

// 5. react-confetti
import Confetti from 'react-confetti';
function T5() {
  return <div style={{ position: 'relative', width: 200, height: 80, overflow: 'hidden' }}>
    <Confetti width={200} height={80} numberOfPieces={20} recycle={false} />
    <span>Confetti rendered</span>
  </div>;
}

// 6. react-scroll
import { Link as ScrollLink, Element as ScrollElement } from 'react-scroll';
function T6() {
  return <div>
    <ScrollLink to="target" smooth={true} duration={200} style={{ cursor: 'pointer', color: '#60a5fa' }}>Scroll to target</ScrollLink>
    <ScrollElement name="target" style={{ marginTop: 8 }}>Target element</ScrollElement>
  </div>;
}

// 7. react-chartjs-2
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title } from 'chart.js';
ChartJS.register(CategoryScale, LinearScale, BarElement, Title);
function T7() {
  const data = {
    labels: ['Jan', 'Feb', 'Mar'],
    datasets: [{ label: 'Revenue', data: [10, 20, 30], backgroundColor: '#60a5fa' }],
  };
  return <div style={{ width: 250, height: 150 }}>
    <Bar data={data} options={{ responsive: true, maintainAspectRatio: false }} />
  </div>;
}

// 8. @mui/material
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MuiSwitch from '@mui/material/Switch';
function T8() {
  const [checked, setChecked] = useState(false);
  return <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <Button variant="contained" size="small">MUI Button</Button>
    <Chip label="MUI Chip" size="small" color="primary" />
    <MuiSwitch checked={checked} onChange={() => setChecked(!checked)} size="small" />
    <span>MUI works</span>
  </div>;
}

// 9. react-slick
import Slider from 'react-slick';
function T9() {
  return <div style={{ width: 200 }}>
    <Slider dots={true} slidesToShow={1} slidesToScroll={1}>
      <div><div style={{ background: '#333', padding: 12, textAlign: 'center' }}>Slide 1</div></div>
      <div><div style={{ background: '#444', padding: 12, textAlign: 'center' }}>Slide 2</div></div>
    </Slider>
  </div>;
}

export default function BatchUI() {
  return (
    <div style={{ fontFamily: 'system-ui', color: '#eee', background: '#111', padding: 16, minHeight: '100vh' }}>
      <h1 style={{ fontSize: 24, marginBottom: 16, color: '#60a5fa' }}>Batch: UI, Animation, Charts</h1>
      <TB name="react-tabs"><T1 /></TB>
      <TB name="react-virtuoso"><T2 /></TB>
      <TB name="react-fast-marquee"><T3 /></TB>
      <TB name="react-type-animation"><T4 /></TB>
      <TB name="react-confetti"><T5 /></TB>
      <TB name="react-scroll"><T6 /></TB>
      <TB name="react-chartjs-2"><T7 /></TB>
      <TB name="@mui/material"><T8 /></TB>
      <TB name="react-slick"><T9 /></TB>
    </div>
  );
}
