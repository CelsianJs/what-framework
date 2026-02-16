export const initialState = {
  step: 0,
  direction: 'forward',
  completed: [],
  data: {},
};

export function wizardReducer(state, action) {
  switch (action.type) {
    case 'NEXT':
      return {
        ...state,
        step: state.step + 1,
        direction: 'forward',
        completed: state.completed.includes(state.step)
          ? state.completed
          : [...state.completed, state.step],
      };
    case 'PREV':
      return {
        ...state,
        step: state.step - 1,
        direction: 'backward',
      };
    case 'GO_TO':
      return {
        ...state,
        step: action.step,
        direction: action.step > state.step ? 'forward' : 'backward',
      };
    case 'SAVE_DATA':
      return {
        ...state,
        data: { ...state.data, ...action.data },
      };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}
