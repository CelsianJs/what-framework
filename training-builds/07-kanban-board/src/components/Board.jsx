import { useMediaQuery, cls } from 'what-framework';
import { Column } from './Column';

export function Board({ search }) {
  const isMobile = useMediaQuery('(max-width: 768px)');

  return (
    <div>
      {() => {
        const mobile = isMobile();
        return (
          <div
            class={cls(
              'board',
              mobile ? 'board--stacked' : 'board--grid'
            )}
            style={`
              display: ${mobile ? 'flex' : 'grid'};
              ${mobile ? 'flex-direction: column;' : 'grid-template-columns: repeat(3, 1fr);'}
              gap: 1.5rem;
              min-height: 60vh;
            `}
          >
            <Column
              id="todo"
              title="To Do"
              color="#3b82f6"
              search={search}
            />
            <Column
              id="in-progress"
              title="In Progress"
              color="#f59e0b"
              search={search}
            />
            <Column
              id="done"
              title="Done"
              color="#22c55e"
              search={search}
            />
          </div>
        );
      }}
    </div>
  );
}
