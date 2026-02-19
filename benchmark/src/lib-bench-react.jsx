/**
 * Library Benchmark — Real React
 * Same tests as lib-bench-what.jsx but running on actual React.
 * Timing is done by the comparison runner (wall-clock round-trip).
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

import { create } from 'zustand';
import { useForm } from 'react-hook-form';
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender } from '@tanstack/react-table';
import { atom, useAtom, useAtomValue, useSetAtom, createStore, Provider as JotaiProvider } from 'jotai';
import { configureStore, createSlice } from '@reduxjs/toolkit';
import { Provider as ReduxProvider, useSelector, useDispatch } from 'react-redux';
import { useVirtualizer } from '@tanstack/react-virtual';

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

// ---- Jotai Benchmark ----
const countAtom = atom(0);
const itemsAtom = atom([]);
const itemCountAtom = atom((get) => get(itemsAtom).length);

function JotaiBenchInner() {
  const [count, setCount] = useAtom(countAtom);
  const [items, setItems] = useAtom(itemsAtom);
  const itemCount = useAtomValue(itemCountAtom);

  window._libBench = window._libBench || {};
  window._libBench.jotai = {
    createItems10k: () => {
      const data = Array.from({ length: 10000 }, (_, i) => ({ id: i, value: `Item ${i}` }));
      setItems(data);
    },
    updateTenth: () => {
      setItems(prev => prev.map((item, i) => i % 10 === 0 ? { ...item, value: item.value + ' !!!' } : item));
    },
    rapidUpdates: () => {
      for (let i = 0; i < 5000; i++) setCount(c => c + 1);
    },
    clear: () => {
      setItems([]);
      setCount(0);
    },
    getCount: () => count,
    getItemCount: () => itemCount,
  };

  return (
    <div>
      <div>Jotai: count={count}, items={itemCount}</div>
      <ul style={{ display: 'none' }}>
        {items.slice(0, 100).map(item => (
          <li key={item.id}>{item.value}</li>
        ))}
      </ul>
    </div>
  );
}

function JotaiBench() {
  return <JotaiBenchInner />;
}

// ---- Redux Toolkit Benchmark ----
const benchSlice = createSlice({
  name: 'bench',
  initialState: { count: 0, items: [] },
  reducers: {
    increment: (state) => { state.count += 1; },
    setItems: (state, action) => { state.items = action.payload; },
    updateEveryTenth: (state) => {
      for (let i = 0; i < state.items.length; i += 10) {
        state.items[i] = { ...state.items[i], value: state.items[i].value + ' !!!' };
      }
    },
    clearItems: (state) => { state.items = []; state.count = 0; },
  },
});

const reduxStore = configureStore({
  reducer: { bench: benchSlice.reducer },
});

function ReduxBenchInner() {
  const count = useSelector(s => s.bench.count);
  const items = useSelector(s => s.bench.items);
  const dispatch = useDispatch();

  window._libBench = window._libBench || {};
  window._libBench.redux = {
    createItems10k: () => {
      const data = Array.from({ length: 10000 }, (_, i) => ({ id: i, value: `Item ${i}` }));
      dispatch(benchSlice.actions.setItems(data));
    },
    updateTenth: () => {
      dispatch(benchSlice.actions.updateEveryTenth());
    },
    rapidUpdates: () => {
      for (let i = 0; i < 5000; i++) dispatch(benchSlice.actions.increment());
    },
    clear: () => {
      dispatch(benchSlice.actions.clearItems());
    },
    getCount: () => count,
    getItemCount: () => items.length,
  };

  return (
    <div>
      <div>Redux: count={count}, items={items.length}</div>
      <ul style={{ display: 'none' }}>
        {items.slice(0, 100).map(item => (
          <li key={item.id}>{item.value}</li>
        ))}
      </ul>
    </div>
  );
}

function ReduxBench() {
  return (
    <ReduxProvider store={reduxStore}>
      <ReduxBenchInner />
    </ReduxProvider>
  );
}

// ---- TanStack Virtual Benchmark ----
function VirtualBench() {
  const [items, setItems] = useState([]);
  const parentRef = useRef(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 35,
    overscan: 5,
  });

  window._libBench = window._libBench || {};
  window._libBench.virtual = {
    createItems50k: () => {
      const data = Array.from({ length: 50000 }, (_, i) => ({ id: i, value: `Row ${i}`, extra: Math.random() }));
      setItems(data);
    },
    createItems10k: () => {
      const data = Array.from({ length: 10000 }, (_, i) => ({ id: i, value: `Row ${i}` }));
      setItems(data);
    },
    updateTenth: () => {
      setItems(prev => prev.map((item, i) => i % 10 === 0 ? { ...item, value: item.value + ' !!!' } : item));
    },
    scrollToMiddle: () => {
      virtualizer.scrollToIndex(Math.floor(items.length / 2));
    },
    scrollToEnd: () => {
      virtualizer.scrollToIndex(items.length - 1);
    },
    clear: () => {
      setItems([]);
    },
    getItemCount: () => items.length,
  };

  return (
    <div>
      <div>Virtual: {items.length} items, rendered: {virtualizer.getVirtualItems().length}</div>
      <div
        ref={parentRef}
        style={{ height: 300, overflow: 'auto', display: 'none' }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map(vRow => (
            <div
              key={vRow.key}
              style={{
                position: 'absolute',
                top: vRow.start,
                height: vRow.size,
                width: '100%',
              }}
            >
              {items[vRow.index]?.value}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Main App ----
function App() {
  return (
    <div style={{ padding: 16, fontFamily: 'monospace', fontSize: 12 }}>
      <h3>React — Library Benchmark</h3>
      <ZustandBench />
      <HookFormBench />
      <TableBench />
      <JotaiBench />
      <ReduxBench />
      <VirtualBench />
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
