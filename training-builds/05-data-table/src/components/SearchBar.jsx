import { useSignal, debounce } from 'what-framework';

export function SearchBar({ searchQuery, onSearch, totalResults }) {
  const localValue = useSignal(searchQuery() || '');

  const debouncedSearch = debounce((val) => {
    onSearch(val);
  }, 300);

  const handleInput = (e) => {
    const val = e.target.value;
    localValue(val);
    debouncedSearch(val);
  };

  const handleClear = () => {
    localValue('');
    onSearch('');
  };

  return (
    <div style="position: relative; margin-bottom: 1.5rem;">
      <div style="position: relative; display: flex; align-items: center; gap: 0.75rem;">
        <div style="position: relative; flex: 1;">
          <svg
            style="position: absolute; left: 0.875rem; top: 50%; transform: translateY(-50%); pointer-events: none;"
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search users by name, email, or role..."
            value={localValue()}
            oninput={handleInput}
            style="width: 100%; padding: 0.75rem 2.5rem 0.75rem 2.75rem; background: #141414; border: 1px solid #2a2a2a; border-radius: 0.625rem; color: #e5e5e5; font-size: 0.875rem; outline: none; transition: border-color 0.2s, box-shadow 0.2s;"
            onfocus={(e) => { e.target.style.borderColor = '#3b82f6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.15)'; }}
            onblur={(e) => { e.target.style.borderColor = '#2a2a2a'; e.target.style.boxShadow = 'none'; }}
          />
          {() => localValue() ? (
            <button
              onclick={handleClear}
              style="position: absolute; right: 0.75rem; top: 50%; transform: translateY(-50%); background: none; border: none; color: #666; font-size: 1.125rem; cursor: pointer; padding: 0.25rem; line-height: 1; border-radius: 50%; transition: color 0.2s;"
              onmouseenter={(e) => { e.target.style.color = '#e5e5e5'; }}
              onmouseleave={(e) => { e.target.style.color = '#666'; }}
            >
              &times;
            </button>
          ) : null}
        </div>
        {() => {
          const total = totalResults();
          return total !== null ? (
            <span style="color: #888; font-size: 0.8125rem; white-space: nowrap; min-width: 80px; text-align: right;">
              {total} result{total !== 1 ? 's' : ''}
            </span>
          ) : null;
        }}
      </div>
    </div>
  );
}
