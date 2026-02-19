import { List } from 'react-window';

const Row = ({ index, style }) => (
  <div style={{
    ...style,
    display: 'flex', alignItems: 'center', padding: '0 12px',
    borderBottom: '1px solid #eee',
    background: index % 2 === 0 ? '#f8f9fa' : 'white',
    color: '#333'
  }}>
    Row {index + 1} — {['Alice', 'Bob', 'Carol', 'Dave', 'Eve'][index % 5]}
  </div>
);

export function ReactWindowTest() {
  return (
    <div>
      <List
        height={200}
        width="100%"
        itemCount={10000}
        itemSize={36}
        style={{ border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden' }}
      >
        {Row}
      </List>
      <p style={{ color: 'green', marginTop: '4px' }}>react-window List with 10,000 rows</p>
    </div>
  );
}
