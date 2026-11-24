import { useRef, useState } from 'react';
import {
  FloatingArrow, FloatingFocusManager, FloatingPortal, arrow, autoUpdate, flip, offset, shift, useClick, useDismiss,
  useFloating, useHover, useInteractions, useListNavigation, useRole,
} from '@floating-ui/react';

function Popover() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const arrowRef = useRef(null);
  const { refs, floatingStyles, context } = useFloating({
    open, onOpenChange: setOpen, placement: 'bottom-start',
    middleware: [offset(10), flip(), shift(), arrow({ element: arrowRef })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context), useRole(context)]);
  return (
    <>
      <button id="fl-ref" ref={refs.setReference} {...getReferenceProps()}>Popover</button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div className="fl-pop" ref={refs.setFloating} style={{ ...floatingStyles, background: '#eee', padding: 8 }} {...getFloatingProps()}>
              <input id="fl-input" value={text} onChange={(e) => setText(e.target.value)} />
              <button id="fl-close" onClick={() => setOpen(false)}>close</button>
              <FloatingArrow ref={arrowRef} context={context} />
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
      <span id="fl-text">{text}</span>
    </>
  );
}

function Tooltip() {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({ open, onOpenChange: setOpen, placement: 'right', middleware: [offset(6)], whileElementsMounted: autoUpdate });
  const { getReferenceProps, getFloatingProps } = useInteractions([useHover(context), useRole(context, { role: 'tooltip' })]);
  return (
    <>
      <button id="fl-tip-ref" ref={refs.setReference} {...getReferenceProps()}>Hover</button>
      {open && <div className="fl-tip" ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()}>tip</div>}
    </>
  );
}

const options = ['Red', 'Green', 'Blue'];
function Menu() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(null);
  const [picked, setPicked] = useState('none');
  const listRef = useRef([]);
  const { refs, floatingStyles, context } = useFloating({ open, onOpenChange: setOpen, placement: 'bottom-start', whileElementsMounted: autoUpdate });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    useClick(context), useDismiss(context), useRole(context, { role: 'menu' }),
    useListNavigation(context, { listRef, activeIndex: active, onNavigate: setActive }),
  ]);
  return (
    <>
      <button className="fl-menu-ref" ref={refs.setReference} {...getReferenceProps()}>Colors</button>
      {open && (
        <FloatingFocusManager context={context} modal={false}>
          <div className="fl-menu" ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()}>
            {options.map((option, i) => (
              <button
                key={option}
                role="menuitem"
                tabIndex={active === i ? 0 : -1}
                ref={(node) => { listRef.current[i] = node; }}
                {...getItemProps({ onClick: () => { setPicked(option); setOpen(false); } })}
              >
                {option}
              </button>
            ))}
          </div>
        </FloatingFocusManager>
      )}
      <span id="fl-picked">{picked}</span>
    </>
  );
}

export default function Fixture() {
  return (
    <div style={{ padding: 40 }}>
      <Popover />
      <div style={{ marginTop: 120 }}><Tooltip /></div>
      <div style={{ marginTop: 40 }}><Menu /></div>
    </div>
  );
}
