import { mount, useSignal, useComputed, useEffect, useRef, batch } from 'what-framework';
import { onResize } from 'what-framework/dom';
import { generateRows } from './data.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ROW_HEIGHT = 40;
const OVERSCAN = 5;
const CONTAINER_HEIGHT = 600;

// Generate dataset once at module level
const ALL_ROWS = generateRows(10000);

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------
const COLUMNS = [
  { key: 'id',         label: 'ID',         width: '70px'  },
  { key: 'name',       label: 'Name',       width: '1fr'   },
  { key: 'email',      label: 'Email',      width: '1.5fr' },
  { key: 'department', label: 'Department', width: '1fr'   },
  { key: 'salary',     label: 'Salary',     width: '100px' },
  { key: 'status',     label: 'Status',     width: '100px' },
];

// ---------------------------------------------------------------------------
// VirtualTable Component
// ---------------------------------------------------------------------------
function VirtualTable() {
  // --- Signals ---
  const searchQuery = useSignal('');
  const sortKey = useSignal('id');
  const sortDirection = useSignal('asc');
  const scrollTop = useSignal(0);
  const containerHeight = useSignal(CONTAINER_HEIGHT);

  // Ref to the scrollable container DOM element
  const containerRef = useRef(null);

  // --- Filtered + sorted rows (derived) ---
  const processedRows = useComputed(() => {
    const query = searchQuery().toLowerCase().trim();
    const key = sortKey();
    const dir = sortDirection();

    // Filter
    let rows = ALL_ROWS;
    if (query) {
      rows = rows.filter(row =>
        row.name.toLowerCase().includes(query) ||
        row.email.toLowerCase().includes(query) ||
        row.department.toLowerCase().includes(query) ||
        row.status.toLowerCase().includes(query) ||
        String(row.id).includes(query) ||
        String(row.salary).includes(query)
      );
    }

    // Sort
    const sorted = [...rows].sort((a, b) => {
      let av = a[key];
      let bv = b[key];
      if (typeof av === 'string') {
        av = av.toLowerCase();
        bv = bv.toLowerCase();
      }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  });

  // --- Total height of virtual content ---
  const totalHeight = useComputed(() => processedRows().length * ROW_HEIGHT);

  // --- Visible row slice (derived from scroll position + container height) ---
  const visibleSlice = useComputed(() => {
    const rows = processedRows();
    const top = scrollTop();
    const height = containerHeight();
    const totalRows = rows.length;

    const startIndex = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
    const visibleCount = Math.ceil(height / ROW_HEIGHT);
    const endIndex = Math.min(totalRows, Math.floor(top / ROW_HEIGHT) + visibleCount + OVERSCAN);

    return {
      rows: rows.slice(startIndex, endIndex),
      startIndex,
      totalFiltered: totalRows,
      visibleCount: endIndex - startIndex,
    };
  });

  // --- Scroll event listener with cleanup ---
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      scrollTop.set(el.scrollTop);
    };

    el.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      el.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // --- Resize observer for container height ---
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const dispose = onResize(el, (rect) => {
      containerHeight.set(rect.height);
    });

    return dispose;
  }, []);

  // --- Sort handler ---
  function handleSort(key) {
    batch(() => {
      if (sortKey() === key) {
        sortDirection.set(d => d === 'asc' ? 'desc' : 'asc');
      } else {
        sortKey.set(key);
        sortDirection.set('asc');
      }
      // Reset scroll when sort changes
      scrollTop.set(0);
      if (containerRef.current) {
        containerRef.current.scrollTop = 0;
      }
    });
  }

  // --- Search handler ---
  function handleSearch(e) {
    searchQuery.set(e.target.value);
    // Reset scroll on search
    scrollTop.set(0);
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }

  // --- Format salary ---
  function formatSalary(n) {
    return '$' + n.toLocaleString('en-US');
  }

  // --- Sort indicator ---
  function sortIndicator(key) {
    if (sortKey() !== key) return '';
    return sortDirection() === 'asc' ? ' ↑' : ' ↓';
  }

  // --- Render ---
  return (
    <main className="app-shell">
      <h1>Large Dataset Viewer</h1>
      <p className="subtitle">
        10,000 rows with virtualized scrolling — only visible rows are rendered.
      </p>

      {/* Toolbar */}
      <div className="toolbar">
        <input
          data-testid="search-input"
          type="text"
          placeholder="Search all fields..."
          value={searchQuery()}
          onInput={handleSearch}
          className="search-input"
        />
        <div className="stats">
          <span data-testid="row-count">
            Rendering {visibleSlice().visibleCount} of {visibleSlice().totalFiltered} rows
          </span>
          <span className="separator">|</span>
          <span data-testid="total-rows">
            Total dataset: {ALL_ROWS.length.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Table header */}
      <div className="table-header" role="row">
        {COLUMNS.map(col => (
          <div
            key={col.key}
            data-testid={`sort-${col.key}`}
            className={`header-cell ${sortKey() === col.key ? 'sorted' : ''}`}
            role="columnheader"
            onClick={() => handleSort(col.key)}
          >
            {col.label}{sortIndicator(col.key)}
          </div>
        ))}
      </div>

      {/* Virtualized scroll container */}
      <div
        data-testid="table-container"
        className="table-container"
        ref={containerRef}
      >
        {/* Inner spacer — full height for correct scrollbar */}
        <div className="table-inner" style={{ height: `${totalHeight()}px` }}>
          {visibleSlice().rows.map((row, i) => {
            const absoluteIndex = visibleSlice().startIndex + i;
            return (
              <div
                key={row.id}
                data-testid={`table-row-${row.id}`}
                className={`table-row ${absoluteIndex % 2 === 0 ? 'even' : 'odd'}`}
                role="row"
                style={{
                  position: 'absolute',
                  top: `${absoluteIndex * ROW_HEIGHT}px`,
                  height: `${ROW_HEIGHT}px`,
                  left: '0',
                  right: '0',
                }}
              >
                <div className="cell cell-id">{row.id}</div>
                <div className="cell cell-name">{row.name}</div>
                <div className="cell cell-email">{row.email}</div>
                <div className="cell cell-department">{row.department}</div>
                <div className="cell cell-salary">{formatSalary(row.salary)}</div>
                <div className="cell cell-status">
                  <span className={`status-badge status-${row.status.toLowerCase().replace(' ', '-')}`}>
                    {row.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------
mount(<VirtualTable />, '#app');
