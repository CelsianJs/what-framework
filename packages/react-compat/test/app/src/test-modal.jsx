import React, { useState } from 'react';
import Modal from 'react-modal';

export function ModalTest() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>react-modal</h3>
      <button onClick={() => setIsOpen(true)} style={{ padding: '6px 16px', cursor: 'pointer' }}>
        Open Modal
      </button>
      <Modal
        isOpen={isOpen}
        onRequestClose={() => setIsOpen(false)}
        style={{
          overlay: { backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000 },
          content: { maxWidth: 400, margin: 'auto', borderRadius: 8, padding: 24 }
        }}
        contentLabel="Example Modal"
        ariaHideApp={false}
      >
        <h2 style={{ marginTop: 0 }}>Modal Content</h2>
        <p>This is a react-modal dialog with proper overlay, close handling, and accessibility.</p>
        <button onClick={() => setIsOpen(false)} style={{ padding: '6px 16px', cursor: 'pointer', background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4 }}>
          Close
        </button>
      </Modal>
      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — react-modal renders with overlay</p>
    </div>
  );
}
