import { useReducer } from 'what-framework';
import { WizardContext } from './context/WizardContext';
import { wizardReducer, initialState } from './utils/wizard-reducer';
import { WizardShell } from './components/WizardShell';

export function App() {
  const [state, dispatch] = useReducer(wizardReducer, initialState);

  // We need to read state reactively, so wrap dispatch actions
  // that also trigger re-renders
  const wizardValue = {
    getState: () => state,
    dispatch,
    next: () => dispatch({ type: 'NEXT' }),
    prev: () => dispatch({ type: 'PREV' }),
    goTo: (step) => dispatch({ type: 'GO_TO', step }),
    saveData: (data) => dispatch({ type: 'SAVE_DATA', data }),
    reset: () => dispatch({ type: 'RESET' }),
  };

  return (
    <WizardContext.Provider value={wizardValue}>
      <div>
        {/* Header */}
        <div style="text-align: center; margin-bottom: 2.5rem;">
          <h1 style="font-size: 1.75rem; font-weight: 800; color: #f5f5f5; margin-bottom: 0.375rem; letter-spacing: -0.02em;">
            Create Account
          </h1>
          <p style="font-size: 0.875rem; color: #666;">
            Complete the steps below to get started
          </p>
        </div>

        <WizardShell />

        <style>{`
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateY(12px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>
      </div>
    </WizardContext.Provider>
  );
}
