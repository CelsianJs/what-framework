import { useRef } from 'react';
import { configureStore, createAsyncThunk, createSelector, createSlice } from '@reduxjs/toolkit';
import { Provider, shallowEqual, useDispatch, useSelector, useStore } from 'react-redux';

const loadItems = createAsyncThunk('items/load', async (n) => {
  const res = await fetch(`/api/items?n=${n}`);
  return (await res.json()).items;
});

const counter = createSlice({
  name: 'counter',
  initialState: { value: 0 },
  reducers: {
    inc: (state) => { state.value += 1; },
    addBy: (state, action) => { state.value += action.payload; },
  },
});
const items = createSlice({
  name: 'items',
  initialState: { list: [], status: 'idle' },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadItems.pending, (state) => { state.status = 'loading'; })
      .addCase(loadItems.fulfilled, (state, action) => { state.status = 'done'; state.list = action.payload; });
  },
});
const store = configureStore({ reducer: { counter: counter.reducer, items: items.reducer } });
window.rStore = store;
window.rInc = counter.actions.inc;

const selectSummary = createSelector([(s) => s.items.list], (list) => ({ n: list.length, first: list[0] ?? 'none' }));

function Count() {
  const renders = useRef(0);
  renders.current++;
  const value = useSelector((s) => s.counter.value);
  const dispatch = useDispatch();
  return (
    <div>
      <span id="r-count" data-renders={renders.current}>{value}</span>
      <button id="r-inc" onClick={() => dispatch(counter.actions.inc())}>inc</button>
      <button id="r-add5" onClick={() => dispatch(counter.actions.addBy(5))}>+5</button>
    </div>
  );
}

function Items() {
  const renders = useRef(0);
  renders.current++;
  const status = useSelector((s) => s.items.status);
  const summary = useSelector(selectSummary);
  const pair = useSelector((s) => ({ a: s.items.list[0], b: s.items.list[1] }), shallowEqual);
  const dispatch = useDispatch();
  const store = useStore();
  return (
    <div>
      <span id="r-status" data-renders={renders.current}>{status}</span>
      <span id="r-summary">{summary.n}:{summary.first}</span>
      <span id="r-pair">{String(pair.a)}|{String(pair.b)}</span>
      <button id="r-load" onClick={() => dispatch(loadItems(store.getState().counter.value))}>load</button>
    </div>
  );
}

export default function Fixture() {
  return (
    <Provider store={store}>
      <Count />
      <Items />
    </Provider>
  );
}
