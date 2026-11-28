// fixture.jsx as a native What file: signals for state, each icon an island.
import { signal } from 'what-framework';
import { Camera, Heart, Loader, Menu, Moon, Sun, X } from 'lucide-react';

export default function Native() {
  const open = signal(false);
  const liked = signal(false);
  const name = signal('Sun');
  const tag = signal('');
  let svg = null;
  return (
    <div>
      <Camera id="lu-camera" size={32} color="red" strokeWidth={3} className="extra" />
      <Camera id="lu-abs" size={48} absoluteStrokeWidth />
      <button id="lu-menu" onClick={() => open(!open())} aria-label="menu">{open() ? <X id="lu-icon" /> : <Menu id="lu-icon" />}</button>
      <button id="lu-like" onClick={() => liked(!liked())}><Heart id="lu-heart" fill={liked() ? 'red' : 'none'} /></button>
      <Loader id="lu-ref" ref={(el) => { svg = el; }} />
      <button id="lu-read" onClick={() => tag(svg ? svg.tagName + ':' + svg.getAttribute('class') : 'null')}>read ref</button>
      <span id="lu-tag">{tag()}</span>
      {name() === 'Sun' ? <Sun id="lu-dynamic" /> : <Moon id="lu-dynamic" />}
      <button id="lu-swap" onClick={() => name(name() === 'Sun' ? 'Moon' : 'Sun')}>swap</button>
    </div>
  );
}
