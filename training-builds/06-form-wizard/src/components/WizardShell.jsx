import { useContext } from 'what-framework';
import { WizardContext } from '../context/WizardContext';
import { ProgressBar } from './ProgressBar';
import { StepAccount } from './StepAccount';
import { StepProfile } from './StepProfile';
import { StepReview } from './StepReview';

export function WizardShell() {
  const wizard = useContext(WizardContext);

  return (
    <div style="max-width: 520px; margin: 0 auto;">
      <ProgressBar />

      <div style="background: #0f0f0f; border: 1px solid #1e1e1e; border-radius: 1rem; padding: 2rem; box-shadow: 0 4px 24px rgba(0,0,0,0.3);">
        {() => {
          const state = wizard.getState();
          const step = state.step;

          if (step === 0) return <StepAccount />;
          if (step === 1) return <StepProfile />;
          if (step === 2) return <StepReview />;
          return null;
        }}
      </div>
    </div>
  );
}
