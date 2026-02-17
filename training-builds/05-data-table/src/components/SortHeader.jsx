export function SortHeader({ label, field, currentSort, currentDir, onSort }) {
  const handleClick = () => {
    if (currentSort() === field) {
      if (currentDir() === 'asc') {
        onSort(field, 'desc');
      } else if (currentDir() === 'desc') {
        onSort('id', 'asc'); // reset to default
      }
    } else {
      onSort(field, 'asc');
    }
  };

  return (
    <th
      onClick={handleClick}
      style="padding: 0.75rem 1rem; text-align: left; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #999; cursor: pointer; user-select: none; transition: color 0.2s; white-space: nowrap; border-bottom: 1px solid #1e1e1e;"
      onMouseEnter={(e) => { e.currentTarget.style.color = '#e5e5e5'; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = '#999'; }}
    >
      <div style="display: flex; align-items: center; gap: 0.375rem;">
        <span>{label}</span>
        {() => {
          const isActive = currentSort() === field;
          const dir = currentDir();
          if (!isActive) {
            return (
              <span style="color: #444; font-size: 0.625rem;">
                &#x2195;
              </span>
            );
          }
          return (
            <span style="color: #3b82f6; font-size: 0.75rem; font-weight: 700;">
              {dir === 'asc' ? '\u2191' : '\u2193'}
            </span>
          );
        }}
      </div>
    </th>
  );
}
