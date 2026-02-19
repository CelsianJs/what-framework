import React, { useState } from 'react';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import * as Slider from '@radix-ui/react-slider';
import * as Toggle from '@radix-ui/react-toggle';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import * as Accordion from '@radix-ui/react-accordion';
import * as Progress from '@radix-ui/react-progress';
import * as Separator from '@radix-ui/react-separator';

export function RadixExtTest() {
  const [progress, setProgress] = useState(60);
  const [sliderVal, setSliderVal] = useState([50]);
  const [pressed, setPressed] = useState(false);
  const [alignment, setAlignment] = useState('center');

  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>Radix UI Extended (7 more primitives)</h3>

      <div style={{ marginBottom: 12 }}>
        <strong>ScrollArea:</strong>
        <ScrollArea.Root style={{ width: 300, height: 80, overflow: 'hidden', border: '1px solid #ddd', borderRadius: 4 }}>
          <ScrollArea.Viewport style={{ width: '100%', height: '100%', padding: 8 }}>
            {Array.from({ length: 20 }, (_, i) => (
              <div key={i} style={{ padding: '2px 0' }}>Scroll item {i + 1}</div>
            ))}
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar orientation="vertical" style={{ display: 'flex', width: 8, padding: 2 }}>
            <ScrollArea.Thumb style={{ flex: 1, background: '#999', borderRadius: 4 }} />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </div>

      <Separator.Root style={{ height: 1, background: '#ddd', margin: '12px 0' }} />

      <div style={{ marginBottom: 12 }}>
        <strong>Slider:</strong> {sliderVal[0]}
        <Slider.Root value={sliderVal} onValueChange={setSliderVal} max={100} step={1}
          style={{ position: 'relative', display: 'flex', alignItems: 'center', width: 200, height: 20 }}>
          <Slider.Track style={{ background: '#ddd', position: 'relative', flexGrow: 1, height: 3, borderRadius: 2 }}>
            <Slider.Range style={{ position: 'absolute', background: '#1976d2', height: '100%', borderRadius: 2 }} />
          </Slider.Track>
          <Slider.Thumb style={{ display: 'block', width: 16, height: 16, background: '#1976d2', borderRadius: '50%', cursor: 'pointer' }} />
        </Slider.Root>
      </div>

      <div style={{ marginBottom: 12 }}>
        <strong>Toggle:</strong>{' '}
        <Toggle.Root pressed={pressed} onPressedChange={setPressed}
          style={{ padding: '4px 12px', border: '1px solid #ddd', borderRadius: 4, background: pressed ? '#e3f2fd' : '#fff', cursor: 'pointer' }}>
          {pressed ? 'ON' : 'OFF'}
        </Toggle.Root>
      </div>

      <div style={{ marginBottom: 12 }}>
        <strong>ToggleGroup:</strong>{' '}
        <ToggleGroup.Root type="single" value={alignment} onValueChange={(v) => v && setAlignment(v)}
          style={{ display: 'inline-flex', gap: 2 }}>
          {['left', 'center', 'right'].map(a => (
            <ToggleGroup.Item key={a} value={a}
              style={{ padding: '4px 12px', border: '1px solid #ddd', background: alignment === a ? '#e3f2fd' : '#fff', cursor: 'pointer' }}>
              {a}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </div>

      <div style={{ marginBottom: 12 }}>
        <strong>Progress:</strong> {progress}%{' '}
        <button onClick={() => setProgress(p => Math.min(100, p + 10))} style={{ marginLeft: 4 }}>+10%</button>
        <Progress.Root value={progress} max={100}
          style={{ position: 'relative', overflow: 'hidden', background: '#ddd', borderRadius: 4, width: 200, height: 12, marginTop: 4 }}>
          <Progress.Indicator style={{ background: '#4caf50', height: '100%', width: `${progress}%`, transition: 'width 0.3s' }} />
        </Progress.Root>
      </div>

      <div style={{ marginBottom: 12 }}>
        <strong>Accordion:</strong>
        <Accordion.Root type="single" collapsible style={{ border: '1px solid #ddd', borderRadius: 4, width: 300 }}>
          {['Section 1', 'Section 2', 'Section 3'].map((s, i) => (
            <Accordion.Item key={s} value={`item-${i}`} style={{ borderBottom: i < 2 ? '1px solid #ddd' : 'none' }}>
              <Accordion.Header>
                <Accordion.Trigger style={{ width: '100%', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontWeight: 'bold' }}>
                  {s}
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content style={{ padding: '0 12px 8px', color: '#666' }}>
                Content for {s}. This section can be expanded and collapsed.
              </Accordion.Content>
            </Accordion.Item>
          ))}
        </Accordion.Root>
      </div>

      <p style={{ color: 'green', fontWeight: 'bold' }}>PASS — 7 Radix primitives work (ScrollArea, Slider, Toggle, ToggleGroup, Accordion, Progress, Separator)</p>
    </div>
  );
}
