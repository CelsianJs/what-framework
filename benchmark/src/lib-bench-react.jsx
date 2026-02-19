/**
 * Library Benchmark — Real React
 * Same tests as lib-bench-what.jsx but running on actual React.
 * Timing is done by the comparison runner (wall-clock round-trip).
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { create } from 'zustand';
import { useForm } from 'react-hook-form';
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender } from '@tanstack/react-table';

// ---- Zustand Benchmark ----
const useCounterStore = create((set) => ({
  count: 0,
  items: [],
  increment: () => set((s) => ({ count: s.count + 1 })),
  setItems: (items) => set({ items }),
  updateEveryTenth: () => set((s) => ({
    items: s.items.map((item, i) => i % 10 === 0 ? { ...item, value: item.value + ' !!!' } : item)
  })),
}));

function ZustandBench() {
  const { count, items, increment, setItems, updateEveryTenth } = useCounterStore();

  window._libBench = window._libBench || {};
  window._libBench.zustand = {
    createItems10k: () => {
      const data = Array.from({ length: 10000 }, (_, i) => ({ id: i, value: `Item ${i}`, tags: ['a', 'b'] }));
      setItems(data);
    },
    createItems1k: () => {
      const data = Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `Item ${i}` }));
      setItems(data);
    },
    updateTenth: () => {
      updateEveryTenth();
    },
    rapidUpdates: () => {
      for (let i = 0; i < 5000; i++) increment();
    },
    clear: () => {
      setItems([]);
    },
    getCount: () => count,
    getItemCount: () => items.length,
  };

  return (
    <div>
      <div>Zustand: count={count}, items={items.length}</div>
      <ul style={{ display: 'none' }}>
        {items.slice(0, 100).map(item => (
          <li key={item.id}>{item.value}</li>
        ))}
      </ul>
    </div>
  );
}

// ---- React Hook Form Benchmark ----
const defaultFields = {};
for (let i = 0; i < 20; i++) defaultFields[`field${i}`] = '';

function HookFormBench() {
  const { register, handleSubmit, setValue, reset, formState } = useForm({
    defaultValues: defaultFields
  });
  const submittedRef = useRef(null);

  window._libBench = window._libBench || {};
  window._libBench.hookForm = {
    setManyFields: () => {
      for (let i = 0; i < 200; i++) {
        setValue(`field${i % 20}`, `value-${i}-${Date.now()}`);
      }
    },
    resetForm: () => {
      reset();
    },
  };

  return (
    <div>
      <form onSubmit={handleSubmit((d) => { submittedRef.current = d; })}>
        {Array.from({ length: 20 }, (_, i) => (
          <input key={i} {...register(`field${i}`)} />
        ))}
      </form>
      <div>Hook Form: {formState.isDirty ? 'dirty' : 'clean'}</div>
    </div>
  );
}

// ---- TanStack Table Benchmark ----
function TableBench() {
  const [data, setData] = useState([]);
  const [sorting, setSorting] = useState([]);

  const columns = [
    { accessorKey: 'id', header: 'ID' },
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'value', header: 'Value' },
    { accessorKey: 'category', header: 'Category' },
  ];

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  window._libBench = window._libBench || {};
  window._libBench.table = {
    createRows5k: () => {
      const cats = ['A', 'B', 'C', 'D', 'E'];
      const rows = Array.from({ length: 5000 }, (_, i) => ({
        id: i,
        name: `Person ${i}`,
        value: Math.random() * 10000 | 0,
        category: cats[i % 5],
      }));
      setData(rows);
    },
    createRows1k: () => {
      const cats = ['A', 'B', 'C', 'D', 'E'];
      const rows = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `Person ${i}`,
        value: Math.random() * 10000 | 0,
        category: cats[i % 5],
      }));
      setData(rows);
    },
    sortByValue: () => {
      setSorting([{ id: 'value', desc: false }]);
    },
    clearSort: () => {
      setSorting([]);
    },
    updateTenth: () => {
      setData(prev => prev.map((row, i) => i % 10 === 0 ? { ...row, value: row.value + 1 } : row));
    },
    clear: () => {
      setData([]);
      setSorting([]);
    },
    getRowCount: () => data.length,
  };

  return (
    <div>
      <div>Table: {data.length} rows, sorting: {sorting.length ? sorting[0].id : 'none'}</div>
      <table style={{ display: 'none' }}>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr key={row.id}>
              {row.getVisibleCells().map(cell => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  return (
    <div style={{ padding: 16, fontFamily: 'monospace', fontSize: 12 }}>
      <h3>React — Library Benchmark</h3>
      <ZustandBench />
      <HookFormBench />
      <TableBench />
      <div id="status">Ready</div>
    </div>
  );
}

const root = createRoot(document.getElementById('main'));
root.render(<App />);

// postMessage bridge — just execute and respond (runner does timing)
window.addEventListener('message', (e) => {
  if (e.data?.type !== 'bench-run') return;
  const { id, test, args } = e.data;
  try {
    const [lib, method] = test.split('.');
    const bench = window._libBench?.[lib];
    if (!bench || !bench[method]) {
      e.source.postMessage({ type: 'bench-result', id, error: `Unknown test: ${test}` }, '*');
      return;
    }
    bench[method](...(args || []));
    // Respond after a microtask flush so React can process
    Promise.resolve().then(() => {
      setTimeout(() => {
        e.source.postMessage({ type: 'bench-result', id }, '*');
      }, 0);
    });
  } catch (err) {
    e.source.postMessage({ type: 'bench-result', id, error: err.message }, '*');
  }
});

// Signal readiness
window.addEventListener('load', () => {
  setTimeout(() => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'bench-ready', framework: 'react' }, '*');
    }
  }, 500);
});
