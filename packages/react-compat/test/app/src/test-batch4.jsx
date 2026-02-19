import React from 'react';
import { CmdkTest } from './test-cmdk.jsx';
import { IntersectionTest } from './test-intersection.jsx';
import { UseDebounceTest } from './test-usedebounce.jsx';
import { UseHooksTsTest } from './test-usehooksts.jsx';
import { PlayerTest } from './test-player.jsx';
import { SkeletonTest } from './test-skeleton.jsx';
import { CountUpTest } from './test-countup.jsx';
import { CopyClipTest } from './test-copyclip.jsx';
import { SpinnersTest } from './test-spinners.jsx';
import { ModalTest } from './test-modal.jsx';
import { DownshiftTest } from './test-downshift.jsx';
import { ResponsiveTest } from './test-responsive.jsx';
import { HotkeysTest } from './test-hotkeys.jsx';
import { VirtuosoTest } from './test-virtuoso.jsx';
import { JsonViewTest } from './test-jsonview.jsx';
import { UidotdevHooksTest } from './test-usehooks.jsx';

const tests = [
  { name: 'cmdk', C: CmdkTest },
  { name: 'react-intersection-observer', C: IntersectionTest },
  { name: 'use-debounce', C: UseDebounceTest },
  { name: 'usehooks-ts', C: UseHooksTsTest },
  { name: 'react-player', C: PlayerTest },
  { name: 'react-loading-skeleton', C: SkeletonTest },
  { name: 'react-countup', C: CountUpTest },
  { name: 'react-copy-to-clipboard', C: CopyClipTest },
  { name: 'react-spinners', C: SpinnersTest },
  { name: 'react-modal', C: ModalTest },
  { name: 'downshift', C: DownshiftTest },
  { name: 'react-responsive', C: ResponsiveTest },
  { name: 'react-hotkeys-hook', C: HotkeysTest },
  { name: 'react-virtuoso', C: VirtuosoTest },
  { name: 'react-json-view-lite', C: JsonViewTest },
  { name: '@uidotdev/usehooks', C: UidotdevHooksTest },
];

function App() {
  return (
    <div style={{ fontFamily: 'system-ui', padding: '2rem', maxWidth: 900, margin: '0 auto' }}>
      <h1>What React Compat — Batch 4 (17 Libraries)</h1>
      <p style={{ color: '#666' }}>Libraries #41-57: Hooks, utilities, UI components</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {tests.map(({ name, C }) => (
          <div key={name}>
            <C />
          </div>
        ))}
      </div>
    </div>
  );
}

import { createRoot } from 'react-dom/client';
const root = createRoot(document.getElementById('app'));
root.render(<App />);
