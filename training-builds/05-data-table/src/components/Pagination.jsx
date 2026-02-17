export function Pagination({ currentPage, totalPages, onPageChange }) {
  const handlePrev = () => {
    const page = currentPage();
    if (page > 1) onPageChange(page - 1);
  };

  const handleNext = () => {
    const page = currentPage();
    const total = totalPages();
    if (page < total) onPageChange(page + 1);
  };

  const btnBase = 'padding: 0.5rem 0.75rem; border-radius: 0.5rem; font-size: 0.8125rem; font-weight: 500; border: 1px solid #2a2a2a; transition: all 0.15s; outline: none;';
  const btnEnabled = `${btnBase} background: #141414; color: #e5e5e5; cursor: pointer;`;
  const btnDisabled = `${btnBase} background: #0e0e0e; color: #444; cursor: not-allowed; border-color: #1a1a1a;`;
  const btnActive = `${btnBase} background: #3b82f6; color: #fff; cursor: default; border-color: #3b82f6;`;

  return (
    <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 1.25rem; padding-top: 1rem;">
      <button
        onClick={handlePrev}
        disabled={currentPage() <= 1}
        style={currentPage() <= 1 ? btnDisabled : btnEnabled}
        onMouseEnter={(e) => { if (currentPage() > 1) { e.target.style.background = '#1e1e1e'; e.target.style.borderColor = '#3b82f6'; } }}
        onMouseLeave={(e) => { if (currentPage() > 1) { e.target.style.background = '#141414'; e.target.style.borderColor = '#2a2a2a'; } }}
      >
        &larr; Previous
      </button>

      <div style="display: flex; align-items: center; gap: 0.375rem;">
        {() => {
          const page = currentPage();
          const total = totalPages();
          const pages = [];
          const maxVisible = 7;

          if (total <= maxVisible) {
            for (let i = 1; i <= total; i++) pages.push(i);
          } else {
            pages.push(1);
            if (page > 3) pages.push('...');

            const start = Math.max(2, page - 1);
            const end = Math.min(total - 1, page + 1);
            for (let i = start; i <= end; i++) pages.push(i);

            if (page < total - 2) pages.push('...');
            pages.push(total);
          }

          return pages.map((p, idx) => {
            if (p === '...') {
              return (
                <span key={`ellipsis-${idx}`} style="padding: 0.5rem 0.25rem; color: #555; font-size: 0.8125rem;">
                  ...
                </span>
              );
            }
            return (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                style={p === page ? btnActive : btnEnabled}
                onMouseEnter={(e) => { if (p !== page) { e.target.style.background = '#1e1e1e'; e.target.style.borderColor = '#3b82f6'; } }}
                onMouseLeave={(e) => { if (p !== page) { e.target.style.background = '#141414'; e.target.style.borderColor = '#2a2a2a'; } }}
              >
                {p}
              </button>
            );
          });
        }}
      </div>

      <button
        onClick={handleNext}
        disabled={currentPage() >= totalPages()}
        style={currentPage() >= totalPages() ? btnDisabled : btnEnabled}
        onMouseEnter={(e) => { if (currentPage() < totalPages()) { e.target.style.background = '#1e1e1e'; e.target.style.borderColor = '#3b82f6'; } }}
        onMouseLeave={(e) => { if (currentPage() < totalPages()) { e.target.style.background = '#141414'; e.target.style.borderColor = '#2a2a2a'; } }}
      >
        Next &rarr;
      </button>
    </div>
  );
}
