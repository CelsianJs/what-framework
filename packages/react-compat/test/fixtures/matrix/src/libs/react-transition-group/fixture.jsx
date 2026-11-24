import { createRef, useRef, useState } from 'react';
import { CSSTransition, SwitchTransition, TransitionGroup } from 'react-transition-group';

let nextId = 3;

export default function Fixture() {
  const [shown, setShown] = useState(false);
  const [log, setLog] = useState([]);
  const [items, setItems] = useState(() => [{ id: 1, ref: createRef() }, { id: 2, ref: createRef() }]);
  const [mode, setMode] = useState('a');
  const boxRef = useRef(null);
  const aRef = useRef(null);
  const bRef = useRef(null);
  const note = (name) => setLog((l) => [...l, name]);
  return (
    <div>
      <style>{'.fade-enter{opacity:0}.fade-enter-active{opacity:1;transition:opacity 150ms}.fade-exit{opacity:1}.fade-exit-active{opacity:0;transition:opacity 150ms}'}</style>
      <button id="tg-toggle" onClick={() => setShown(!shown)}>toggle</button>
      <CSSTransition nodeRef={boxRef} in={shown} timeout={150} classNames="fade" unmountOnExit onEnter={() => note('enter')} onEntered={() => note('entered')} onExit={() => note('exit')} onExited={() => note('exited')}>
        <div id="tg-box" ref={boxRef}>box</div>
      </CSSTransition>
      <span id="tg-log">{log.join(',')}</span>

      <button id="tg-add" onClick={() => setItems([...items, { id: nextId++, ref: createRef() }])}>add</button>
      <TransitionGroup component="ul" id="tg-list">
        {items.map((item) => (
          <CSSTransition key={item.id} nodeRef={item.ref} timeout={150} classNames="fade">
            <li ref={item.ref} className="tg-item">
              item {item.id} <button className="tg-remove" onClick={() => setItems((list) => list.filter((x) => x.id !== item.id))}>x</button>
            </li>
          </CSSTransition>
        ))}
      </TransitionGroup>

      <button id="tg-switch" onClick={() => setMode(mode === 'a' ? 'b' : 'a')}>switch</button>
      <SwitchTransition mode="out-in">
        <CSSTransition key={mode} nodeRef={mode === 'a' ? aRef : bRef} timeout={150} classNames="fade">
          <p id="tg-mode" ref={mode === 'a' ? aRef : bRef}>mode {mode}</p>
        </CSSTransition>
      </SwitchTransition>
    </div>
  );
}
