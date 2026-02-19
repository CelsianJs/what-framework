import { configureStore, createSlice } from '@reduxjs/toolkit';
import { Provider, useSelector, useDispatch } from 'react-redux';

const counterSlice = createSlice({
  name: 'counter',
  initialState: { value: 0 },
  reducers: {
    increment: state => { state.value += 1; },
    decrement: state => { state.value -= 1; },
    incrementByAmount: (state, action) => { state.value += action.payload; },
  },
});

const store = configureStore({ reducer: { counter: counterSlice.reducer } });
const { increment, decrement, incrementByAmount } = counterSlice.actions;

function Counter() {
  const count = useSelector(state => state.counter.value);
  const dispatch = useDispatch();
  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button onclick={() => dispatch(decrement())}>-</button>
        <strong style={{ fontSize: '20px', minWidth: '40px', textAlign: 'center' }}>{count}</strong>
        <button onclick={() => dispatch(increment())}>+</button>
        <button onclick={() => dispatch(incrementByAmount(5))}>+5</button>
      </div>
      <p style={{ color: 'green', marginTop: '4px' }}>Redux Toolkit + React-Redux working via useSelector/useDispatch</p>
    </div>
  );
}

export function ReduxTest() {
  return (
    <Provider store={store}>
      <Counter />
    </Provider>
  );
}
