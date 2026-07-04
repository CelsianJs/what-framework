// Valid what-react usage. Must type-check clean via what-react's shipped .d.ts.
import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useReducer,
  useCallback,
  createContext,
  useContext,
  forwardRef,
  memo,
  Fragment,
} from 'what-react';

interface CounterProps {
  start: number;
  label?: string;
}

const Ctx = createContext<{ theme: string }>({ theme: 'light' });

function Counter({ start, label }: CounterProps) {
  const [count, setCount] = useState(start);
  const [total, dispatch] = useReducer(
    (s: number, action: { type: 'add'; by: number }) => s + action.by,
    0,
  );
  const doubled = useMemo(() => count * 2, [count]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { theme } = useContext(Ctx);

  const onClick = useCallback(() => {
    setCount((c) => c + 1);
    dispatch({ type: 'add', by: 1 });
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {};
  }, []);

  return (
    <div className="counter" data-theme={theme}>
      <span>{label ?? 'count'}: {count}</span>
      <span>doubled: {doubled}</span>
      <span>total: {total}</span>
      <input ref={inputRef} type="number" value={count} />
      <button type="button" onClick={onClick}>
        increment
      </button>
    </div>
  );
}

const Boxed = forwardRef<HTMLDivElement, { text: string }>((props, ref) => (
  <div ref={ref}>{props.text}</div>
));

const MemoCounter = memo(Counter);

export function App() {
  return (
    <Ctx.Provider value={{ theme: 'dark' }}>
      <Fragment>
        <MemoCounter start={0} label="hits" />
        <Boxed text="hi" />
      </Fragment>
    </Ctx.Provider>
  );
}

// React default namespace object is typed too.
export const v: string = React.version;
