/**
 * Test: @tanstack/react-table — headless table/datagrid
 * 5.3M weekly downloads. Pure hooks API (useReactTable).
 */
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import { useState, useMemo } from 'react';

const columnHelper = createColumnHelper();

const defaultData = [
  { id: 1, name: 'Alice Johnson', role: 'Engineer', department: 'Frontend', salary: 125000 },
  { id: 2, name: 'Bob Smith', role: 'Designer', department: 'Product', salary: 110000 },
  { id: 3, name: 'Charlie Brown', role: 'PM', department: 'Product', salary: 130000 },
  { id: 4, name: 'Diana Ross', role: 'Engineer', department: 'Backend', salary: 135000 },
  { id: 5, name: 'Eve Davis', role: 'QA', department: 'Engineering', salary: 95000 },
  { id: 6, name: 'Frank Lee', role: 'DevOps', department: 'Infrastructure', salary: 140000 },
];

export function TableTest() {
  const [data] = useState(defaultData);
  const [sorting, setSorting] = useState([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const columns = useMemo(() => [
    columnHelper.accessor('name', { header: 'Name', cell: info => info.getValue() }),
    columnHelper.accessor('role', { header: 'Role' }),
    columnHelper.accessor('department', { header: 'Dept' }),
    columnHelper.accessor('salary', {
      header: 'Salary',
      cell: info => '$' + info.getValue().toLocaleString(),
    }),
  ], []);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div>
      <input
        value={globalFilter ?? ''}
        oninput={e => setGlobalFilter(e.target.value)}
        placeholder="Search all columns..."
        style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #ccc', marginBottom: '8px', width: '300px' }}
      />
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '14px' }}>
        <thead>
          {table.getHeaderGroups().map(hg => (
            <tr key={hg.id}>
              {hg.headers.map(header => (
                <th
                  key={header.id}
                  onclick={header.column.getToggleSortingHandler()}
                  style={{ borderBottom: '2px solid #e5e7eb', padding: '8px', textAlign: 'left', cursor: 'pointer', userSelect: 'none' }}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted()] ?? ''}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr key={row.id}>
              {row.getVisibleCells().map(cell => (
                <td key={cell.id} style={{ borderBottom: '1px solid #f3f4f6', padding: '8px' }}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ color: '#666', fontSize: '12px', marginTop: '4px' }}>
        {table.getRowModel().rows.length} rows shown
      </p>
      <p style={{ color: 'green' }} id="table-status">TanStack Table loaded OK</p>
    </div>
  );
}
