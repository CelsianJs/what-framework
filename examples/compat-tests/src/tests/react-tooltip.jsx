import { Tooltip } from 'react-tooltip';

function TestComponent() {
  return (
    <div>
      <button
        data-tooltip-id="compat-tooltip"
        data-tooltip-content="This is a tooltip from react-tooltip!"
        style={{
          padding: '4px 12px',
          background: '#333',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        Hover me for tooltip
      </button>
      <Tooltip id="compat-tooltip" place="bottom" />
    </div>
  );
}

TestComponent.packageName = 'react-tooltip';
TestComponent.downloads = '1.6M/week';
export default TestComponent;
