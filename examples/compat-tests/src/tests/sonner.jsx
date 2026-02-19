import { useState } from 'react';
import { Toaster, toast } from 'sonner';

function TestComponent() {
  const [count, setCount] = useState(0);

  function handleClick() {
    setCount(c => c + 1);
    toast('Hello from sonner! Toast #' + (count + 1));
  }

  return (
    <div>
      <Toaster position="bottom-right" />
      <button
        onclick={handleClick}
        style={{ padding: '6px 12px', cursor: 'pointer', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
      >
        Show Toast ({count} sent)
      </button>
    </div>
  );
}

TestComponent.packageName = 'sonner';
TestComponent.downloads = '9.9M/week';
export default TestComponent;
