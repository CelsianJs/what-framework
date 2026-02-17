import { useContext } from 'what-framework';
import { WizardContext } from '../context/WizardContext';

const STEPS = [
  { label: 'Account', icon: '1' },
  { label: 'Profile', icon: '2' },
  { label: 'Review', icon: '3' },
];

export function ProgressBar() {
  const wizard = useContext(WizardContext);

  return (
    <div style="margin-bottom: 2.5rem;">
      {/* Step indicators */}
      <div style="display: flex; align-items: center; justify-content: center; position: relative;">
        {STEPS.map((s, i) => {
          const isLast = i === STEPS.length - 1;
          return (
            <div key={i} style="display: flex; align-items: center;">
              {/* Step circle + label */}
              <div
                style="display: flex; flex-direction: column; align-items: center; cursor: pointer; position: relative; z-index: 1;"
                onClick={() => {
                  const state = wizard.getState();
                  // Only allow going to completed steps or the current step
                  if (state.completed.includes(i) || i === state.step) {
                    wizard.goTo(i);
                  }
                }}
              >
                {() => {
                  const state = wizard.getState();
                  const current = state.step;
                  const completed = state.completed;
                  const isCompleted = completed.includes(i);
                  const isCurrent = current === i;

                  let circleStyle = 'width: 2.5rem; height: 2.5rem; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.8125rem; font-weight: 700; transition: all 0.3s; ';
                  if (isCompleted && !isCurrent) {
                    circleStyle += 'background: #22c55e; color: #fff; border: 2px solid #22c55e; box-shadow: 0 0 12px #22c55e33;';
                  } else if (isCurrent) {
                    circleStyle += 'background: #3b82f6; color: #fff; border: 2px solid #3b82f6; box-shadow: 0 0 16px #3b82f633;';
                  } else {
                    circleStyle += 'background: #1a1a1a; color: #555; border: 2px solid #2a2a2a;';
                  }

                  return [
                    <div style={circleStyle}>
                      {isCompleted && !isCurrent ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        s.icon
                      )}
                    </div>,
                    <span style={`margin-top: 0.5rem; font-size: 0.75rem; font-weight: 500; transition: color 0.3s; ${isCurrent ? 'color: #3b82f6;' : 'color: #666;'}`}>
                      {s.label}
                    </span>
                  ];
                }}
              </div>

              {/* Connector line */}
              {!isLast && (
                <div style="width: 6rem; height: 2px; margin: 0 0.75rem; margin-bottom: 1.5rem; position: relative; background: #2a2a2a; border-radius: 1px; overflow: hidden;">
                  {() => {
                    const state = wizard.getState();
                    const completed = state.completed;
                    const isLineCompleted = completed.includes(i);
                    return (
                      <div style={`position: absolute; top: 0; left: 0; height: 100%; background: #22c55e; border-radius: 1px; transition: width 0.4s ease; width: ${isLineCompleted ? '100%' : '0%'};`} />
                    );
                  }}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Progress percentage bar */}
      <div style="margin-top: 1.25rem; background: #1a1a1a; border-radius: 999px; height: 4px; overflow: hidden;">
        {() => {
          const state = wizard.getState();
          const progress = ((state.step) / (STEPS.length - 1)) * 100;
          return (
            <div style={`height: 100%; background: linear-gradient(90deg, #3b82f6, #8b5cf6); border-radius: 999px; transition: width 0.4s ease; width: ${progress}%;`} />
          );
        }}
      </div>
    </div>
  );
}
