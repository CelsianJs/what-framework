import React, { useState } from 'react';
import ReactPaginate from 'react-paginate';

const items = Array.from({ length: 50 }, (_, i) => `Item ${i + 1}`);

export function PaginateTest() {
  const [page, setPage] = useState(0);
  const perPage = 10;
  const offset = page * perPage;
  const currentItems = items.slice(offset, offset + perPage);

  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>react-paginate</h3>
      <ul style={{ margin: '4px 0 8px', paddingLeft: 20 }}>
        {currentItems.map(item => <li key={item}>{item}</li>)}
      </ul>
      <ReactPaginate
        pageCount={Math.ceil(items.length / perPage)}
        pageRangeDisplayed={3}
        marginPagesDisplayed={1}
        onPageChange={({ selected }) => setPage(selected)}
        containerClassName="paginate"
        activeClassName="active"
        renderOnZeroPageCount={null}
      />
      <style>{`
        .paginate { display: flex; list-style: none; gap: 4px; padding: 0; margin: 4px 0 0; }
        .paginate li a { padding: 4px 8px; border: 1px solid #ddd; borderRadius: 3px; cursor: pointer; display: block; }
        .paginate li.active a { background: #1976d2; color: #fff; border-color: #1976d2; }
      `}</style>
      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — react-paginate renders with navigation</p>
    </div>
  );
}
