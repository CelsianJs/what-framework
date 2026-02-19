import { useState, useRef } from 'react';
import { CSSTransition } from 'react-transition-group';

// Inline styles for the fade transition since CSSTransition
// adds classNames that we need CSS rules for
const transitionStyles = `
  .fade-enter { opacity: 0; transform: translateY(-10px); }
  .fade-enter-active { opacity: 1; transform: translateY(0); transition: opacity 300ms, transform 300ms; }
  .fade-exit { opacity: 1; transform: translateY(0); }
  .fade-exit-active { opacity: 0; transform: translateY(-10px); transition: opacity 300ms, transform 300ms; }
`;

function TestComponent() {
  const [show, setShow] = useState(true);
  const nodeRef = useRef(null);

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: transitionStyles }} />
      <button
        onclick={() => setShow(prev => !prev)}
        style={{
          padding: '6px 14px',
          background: '#1a1a2e',
          color: '#e5e5e5',
          border: '1px solid #444',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px',
          marginBottom: '8px',
        }}
      >
        {show ? 'Hide' : 'Show'}
      </button>
      <CSSTransition
        in={show}
        timeout={300}
        classNames="fade"
        unmountOnExit
        nodeRef={nodeRef}
      >
        <div
          ref={nodeRef}
          style={{
            padding: '10px 14px',
            background: '#1e3a5f',
            borderRadius: '6px',
            color: '#93c5fd',
            fontSize: '13px',
          }}
        >
          This content fades in and out with CSSTransition
        </div>
      </CSSTransition>
      <div style={{ marginTop: '6px', fontSize: '11px', color: '#888' }}>
        Uses CSSTransition with nodeRef (avoids findDOMNode)
      </div>
    </div>
  );
}

TestComponent.packageName = 'react-transition-group';
TestComponent.downloads = '22M/week';
export default TestComponent;
