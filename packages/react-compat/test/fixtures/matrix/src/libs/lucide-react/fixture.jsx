import { useRef, useState } from 'react';
import { Camera, Heart, Loader, Menu, X, icons } from 'lucide-react';

export default function Fixture() {
  const [open, setOpen] = useState(false);
  const [liked, setLiked] = useState(false);
  const [name, setName] = useState('Sun');
  const ref = useRef(null);
  const [tag, setTag] = useState('');
  const Dynamic = icons[name];
  return (
    <div>
      <Camera id="lu-camera" size={32} color="red" strokeWidth={3} className="extra" />
      <Camera id="lu-abs" size={48} absoluteStrokeWidth />
      <button id="lu-menu" onClick={() => setOpen(!open)} aria-label="menu">{open ? <X id="lu-icon" /> : <Menu id="lu-icon" />}</button>
      <button id="lu-like" onClick={() => setLiked(!liked)}><Heart id="lu-heart" fill={liked ? 'red' : 'none'} /></button>
      <Loader id="lu-ref" ref={ref} />
      <button id="lu-read" onClick={() => setTag(ref.current ? ref.current.tagName + ':' + ref.current.getAttribute('class') : 'null')}>read ref</button>
      <span id="lu-tag">{tag}</span>
      <Dynamic id="lu-dynamic" />
      <button id="lu-swap" onClick={() => setName(name === 'Sun' ? 'Moon' : 'Sun')}>swap</button>
    </div>
  );
}
