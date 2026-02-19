/**
 * Test: AG Grid React inside What Framework
 *
 * AG Grid is the most complex data grid in the React ecosystem:
 * - Virtualised rendering (only visible rows in DOM)
 * - Column definitions with sorting, filtering, resizing
 * - Cell rendering with custom components
 * - Complex internal state management
 * - Event system (onGridReady, onCellValueChanged, etc.)
 * - Refs for grid API access
 */
import { useState, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';

// Register all community modules
ModuleRegistry.registerModules([AllCommunityModule]);

export function AgGridTest() {
  const gridRef = useRef(null);

  const [rowData] = useState([
    { make: 'Tesla', model: 'Model Y', price: 64950, year: 2024, electric: true },
    { make: 'Ford', model: 'F-Series', price: 33695, year: 2024, electric: false },
    { make: 'Toyota', model: 'Corolla', price: 22050, year: 2024, electric: false },
    { make: 'Mercedes', model: 'EQS', price: 104400, year: 2024, electric: true },
    { make: 'BMW', model: 'iX', price: 87100, year: 2024, electric: true },
    { make: 'Fiat', model: '500', price: 15495, year: 2023, electric: false },
    { make: 'Nissan', model: 'Leaf', price: 28140, year: 2024, electric: true },
    { make: 'Audi', model: 'e-tron GT', price: 106395, year: 2024, electric: true },
    { make: 'Honda', model: 'Civic', price: 23950, year: 2024, electric: false },
    { make: 'Hyundai', model: 'Ioniq 5', price: 41450, year: 2024, electric: true },
  ]);

  const [colDefs] = useState([
    { field: 'make', filter: true, sortable: true },
    { field: 'model', filter: true, sortable: true },
    {
      field: 'price',
      filter: 'agNumberColumnFilter',
      sortable: true,
      valueFormatter: (p) => '$' + (p.value || 0).toLocaleString(),
    },
    { field: 'year', filter: true, sortable: true },
    {
      field: 'electric',
      sortable: true,
      cellRenderer: (p) => (p.value ? 'Yes' : 'No'),
    },
  ]);

  const defaultColDef = useMemo(() => ({
    flex: 1,
    minWidth: 100,
  }), []);

  const onGridReady = useCallback((params) => {
    console.log('[AG Grid] Grid ready, API available');
  }, []);

  const onSortRows = useCallback(() => {
    if (gridRef.current?.api) {
      gridRef.current.api.applyColumnState({
        state: [{ colId: 'price', sort: 'asc' }],
      });
    }
  }, []);

  const onResetSort = useCallback(() => {
    if (gridRef.current?.api) {
      gridRef.current.api.applyColumnState({
        defaultState: { sort: null },
      });
    }
  }, []);

  return (
    <div>
      <div style={{ marginBottom: '8px' }}>
        <button
          onclick={onSortRows}
          style={{
            padding: '4px 12px',
            marginRight: '8px',
            borderRadius: '4px',
            border: '1px solid #ccc',
            background: '#f5f5f5',
            cursor: 'pointer',
          }}
        >
          Sort by Price
        </button>
        <button
          onclick={onResetSort}
          style={{
            padding: '4px 12px',
            borderRadius: '4px',
            border: '1px solid #ccc',
            background: '#f5f5f5',
            cursor: 'pointer',
          }}
        >
          Reset Sort
        </button>
      </div>
      <div style={{ height: 350, width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          rowData={rowData}
          columnDefs={colDefs}
          defaultColDef={defaultColDef}
          onGridReady={onGridReady}
          animateRows={true}
          rowSelection="multiple"
        />
      </div>
      <p style={{ color: 'green' }} id="aggrid-status">AG Grid loaded OK</p>
    </div>
  );
}
