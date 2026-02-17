import { useSignal, useContext } from 'what-framework';
import { WizardContext } from '../context/WizardContext';

function ReviewField({ label, value }) {
  return (
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0; border-bottom: 1px solid #1a1a1a;">
      <span style="font-size: 0.8125rem; color: #888;">{label}</span>
      <span style="font-size: 0.875rem; color: #e5e5e5; font-weight: 500; text-align: right; max-width: 60%; word-break: break-word;">
        {value || '(not set)'}
      </span>
    </div>
  );
}

export function StepReview() {
  const wizard = useContext(WizardContext);
  const isSubmitted = useSignal(false);
  const isSubmitting = useSignal(false);

  const handleSubmit = async () => {
    isSubmitting(true);
    // Simulate API call
    await new Promise(r => setTimeout(r, 1500));
    isSubmitting(false);
    isSubmitted(true);
  };

  const handleReset = () => {
    wizard.reset();
    isSubmitted(false);
  };

  return (
    <div style="animation: slideIn 0.3s ease-out;">
      {() => {
        if (isSubmitted()) {
          return (
            <div style="text-align: center; padding: 2rem 0;">
              <div style="width: 4rem; height: 4rem; background: #052e16; border: 2px solid #22c55e; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; box-shadow: 0 0 24px #22c55e22;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h2 style="font-size: 1.5rem; font-weight: 700; color: #f5f5f5; margin-bottom: 0.5rem;">Account Created!</h2>
              <p style="font-size: 0.875rem; color: #888; margin-bottom: 2rem; max-width: 360px; margin-left: auto; margin-right: auto; line-height: 1.5;">
                Your account has been successfully created. Welcome aboard!
              </p>
              <button
                onClick={handleReset}
                style="padding: 0.75rem 2rem; background: #1a1a1a; color: #e5e5e5; border: 1px solid #2a2a2a; border-radius: 0.625rem; font-size: 0.875rem; font-weight: 500; cursor: pointer; transition: all 0.2s;"
                onMouseEnter={(e) => { e.target.style.background = '#222'; e.target.style.borderColor = '#3b82f6'; }}
                onMouseLeave={(e) => { e.target.style.background = '#1a1a1a'; e.target.style.borderColor = '#2a2a2a'; }}
              >
                Start Over
              </button>
            </div>
          );
        }

        const data = wizard.getState().data;

        return (
          <div>
            <div style="text-align: center; margin-bottom: 2rem;">
              <h2 style="font-size: 1.375rem; font-weight: 700; color: #f5f5f5; margin-bottom: 0.375rem;">Review your information</h2>
              <p style="font-size: 0.8125rem; color: #666;">Please verify everything looks correct</p>
            </div>

            {/* Account Section */}
            <div style="background: #111; border: 1px solid #1e1e1e; border-radius: 0.75rem; padding: 1.25rem; margin-bottom: 1rem;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
                <h3 style="font-size: 0.9375rem; font-weight: 600; color: #e5e5e5;">Account</h3>
                <button
                  onClick={() => wizard.goTo(0)}
                  style="padding: 0.25rem 0.75rem; background: none; border: 1px solid #2a2a2a; border-radius: 0.375rem; color: #3b82f6; font-size: 0.75rem; cursor: pointer; transition: all 0.2s;"
                  onMouseEnter={(e) => { e.target.style.borderColor = '#3b82f6'; e.target.style.background = '#0c1a30'; }}
                  onMouseLeave={(e) => { e.target.style.borderColor = '#2a2a2a'; e.target.style.background = 'none'; }}
                >
                  Edit
                </button>
              </div>
              <ReviewField label="Email" value={data.email} />
              <ReviewField label="Password" value={data.password ? '\u2022'.repeat(Math.min(data.password.length, 12)) : ''} />
            </div>

            {/* Profile Section */}
            <div style="background: #111; border: 1px solid #1e1e1e; border-radius: 0.75rem; padding: 1.25rem; margin-bottom: 1.5rem;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
                <h3 style="font-size: 0.9375rem; font-weight: 600; color: #e5e5e5;">Profile</h3>
                <button
                  onClick={() => wizard.goTo(1)}
                  style="padding: 0.25rem 0.75rem; background: none; border: 1px solid #2a2a2a; border-radius: 0.375rem; color: #3b82f6; font-size: 0.75rem; cursor: pointer; transition: all 0.2s;"
                  onMouseEnter={(e) => { e.target.style.borderColor = '#3b82f6'; e.target.style.background = '#0c1a30'; }}
                  onMouseLeave={(e) => { e.target.style.borderColor = '#2a2a2a'; e.target.style.background = 'none'; }}
                >
                  Edit
                </button>
              </div>
              <ReviewField label="Full Name" value={data.fullName} />
              <ReviewField label="Username" value={data.username ? `@${data.username}` : ''} />
              <ReviewField label="Bio" value={data.bio || '(none)'} />
              <ReviewField label="Role" value={data.role} />
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0;">
                <span style="font-size: 0.8125rem; color: #888;">Terms accepted</span>
                <span style={`font-size: 0.875rem; font-weight: 500; ${data.agreeTerms ? 'color: #22c55e;' : 'color: #ef4444;'}`}>
                  {data.agreeTerms ? 'Yes' : 'No'}
                </span>
              </div>
            </div>

            {/* Buttons */}
            <div style="display: flex; gap: 0.75rem;">
              <button
                type="button"
                onClick={() => wizard.prev()}
                style="flex: 1; padding: 0.75rem; background: #1a1a1a; color: #ccc; border: 1px solid #2a2a2a; border-radius: 0.625rem; font-size: 0.9375rem; font-weight: 500; cursor: pointer; transition: all 0.2s;"
                onMouseEnter={(e) => { e.target.style.background = '#222'; e.target.style.borderColor = '#444'; }}
                onMouseLeave={(e) => { e.target.style.background = '#1a1a1a'; e.target.style.borderColor = '#2a2a2a'; }}
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting()}
                style={`flex: 2; padding: 0.75rem; border: none; border-radius: 0.625rem; font-size: 0.9375rem; font-weight: 600; cursor: pointer; transition: background 0.2s; ${isSubmitting() ? 'background: #1e40af; color: #93c5fd; cursor: wait;' : 'background: #22c55e; color: white;'}`}
                onMouseEnter={(e) => { if (!isSubmitting()) e.target.style.background = '#16a34a'; }}
                onMouseLeave={(e) => { if (!isSubmitting()) e.target.style.background = '#22c55e'; }}
              >
                {() => isSubmitting() ? 'Creating account...' : 'Create Account'}
              </button>
            </div>
          </div>
        );
      }}
    </div>
  );
}
