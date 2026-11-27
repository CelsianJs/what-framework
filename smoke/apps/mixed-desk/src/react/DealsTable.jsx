// The largest deals, as a TanStack Table over every deal in the store, sorted
// by notional and paginated.
import {
  createColumnHelper, createPaginatedRowModel, createSortedRowModel, rowPaginationFeature, rowSortingFeature,
  sortFns, tableFeatures, useTable,
} from '@tanstack/react-table';
import { useProbe } from './probe.js';

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns,
});
const helper = createColumnHelper();
const columns = helper.columns([
  helper.accessor('name', { header: 'Deal' }),
  helper.accessor('desk', { header: 'Desk' }),
  helper.accessor('notional', { header: 'Notional', cell: (info) => <b>{info.getValue()}</b> }),
]);

export function DealsTable({ deals }) {
  useProbe('deals-table');
  const table = useTable({
    features, columns, data: deals,
    getRowId: (row) => String(row.id),
    initialState: { sorting: [{ id: 'notional', desc: true }], pagination: { pageIndex: 0, pageSize: 10 } },
  });
  return (
    <table className="deals-table" data-deals-table>
      <thead>
        {table.getHeaderGroups().map((g) => (
          <tr key={g.id}>
            {g.headers.map((h) => (
              <th key={h.id} data-th={h.column.id} data-sort={h.column.getIsSorted() || 'none'} onClick={h.column.getToggleSortingHandler()}>
                <table.FlexRender header={h} />
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id} data-table-row={row.id}>
            {row.getAllCells().map((cell) => <td key={cell.id}><table.FlexRender cell={cell} /></td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
