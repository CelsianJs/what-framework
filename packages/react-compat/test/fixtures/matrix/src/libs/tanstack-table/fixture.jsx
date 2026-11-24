import { useState } from 'react';
import {
  columnFilteringFeature, createColumnHelper, createFilteredRowModel, createPaginatedRowModel, createSortedRowModel,
  filterFns, rowPaginationFeature, rowSortingFeature, sortFns, tableFeatures, useTable,
} from '@tanstack/react-table';

const features = tableFeatures({
  columnFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filterFns,
  sortFns,
});
const helper = createColumnHelper();
const columns = helper.columns([
  helper.accessor('name', { header: 'Name', filterFn: 'includesString' }),
  helper.accessor('age', { header: 'Age', cell: (info) => <b>{info.getValue()}</b> }),
  helper.accessor('city', { header: () => <i>City</i> }),
]);
const people = [
  ['Linus', 54, 'Portland'], ['Ada', 36, 'London'], ['Grace', 85, 'Arlington'], ['Margaret', 61, 'Boston'],
  ['Alan', 41, 'London'], ['Barbara', 77, 'Boston'], ['Dennis', 70, 'Berkeley'],
].map(([name, age, city]) => ({ name, age, city }));

export default function Fixture() {
  const [data, setData] = useState(people);
  const table = useTable({ features, columns, data, initialState: { pagination: { pageIndex: 0, pageSize: 3 } } });
  return (
    <div>
      <input id="tt-filter" placeholder="filter name" onChange={(e) => table.getColumn('name').setFilterValue(e.target.value)} />
      <table id="tt-table">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id} id={`tt-h-${header.column.id}`} onClick={header.column.getToggleSortingHandler()} data-sort={header.column.getIsSorted() || 'none'}>
                  <table.FlexRender header={header} />
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getAllCells().map((cell) => <td key={cell.id}><table.FlexRender cell={cell} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <button id="tt-prev" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>prev</button>
      <button id="tt-next" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>next</button>
      <span id="tt-page">{table.state.pagination.pageIndex + 1}/{table.getPageCount()}</span>
      <button id="tt-add" onClick={() => setData([...data, { name: 'Aaron', age: 20, city: 'Zurich' }])}>add row</button>
    </div>
  );
}
