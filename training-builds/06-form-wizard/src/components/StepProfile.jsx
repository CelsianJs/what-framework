import { useForm, rules, simpleResolver, useContext } from 'what-framework';
import { WizardContext } from '../context/WizardContext';
import { inputStyle, labelStyle, errorStyle, focusInput, blurInput } from '../utils/form-styles';

export function StepProfile() {
  const wizard = useContext(WizardContext);

  // Restore previously saved data
  const savedData = wizard.getState().data;

  const { register, handleSubmit, formState, getValue } = useForm({
    defaultValues: {
      fullName: savedData.fullName || '',
      username: savedData.username || '',
      bio: savedData.bio || '',
      role: savedData.role || '',
      agreeTerms: savedData.agreeTerms || '',
    },
    mode: 'onBlur',
    resolver: simpleResolver({
      fullName: [
        rules.required('Full name is required'),
      ],
      username: [
        rules.required('Username is required'),
        rules.minLength(3, 'Username must be at least 3 characters'),
        rules.pattern(/^[a-z0-9_]+$/, 'Only lowercase letters, numbers, and underscores'),
      ],
      bio: [
        rules.maxLength(200, 'Bio must be 200 characters or less'),
      ],
      role: [
        rules.required('Please select a role'),
      ],
      agreeTerms: [
        (value) => {
          if (!value || value === '' || value === false) return 'You must agree to the terms';
        },
      ],
    }),
  });

  const fullNameField = register('fullName');
  const usernameField = register('username');
  const bioField = register('bio');
  const roleField = register('role');
  const agreeTermsField = register('agreeTerms');

  const onSubmit = handleSubmit((values) => {
    wizard.saveData({
      fullName: values.fullName,
      username: values.username,
      bio: values.bio,
      role: values.role,
      agreeTerms: values.agreeTerms,
    });
    wizard.next();
  });

  const handleBack = () => {
    // Save current data before going back
    wizard.saveData({
      fullName: getValue('fullName'),
      username: getValue('username'),
      bio: getValue('bio'),
      role: getValue('role'),
      agreeTerms: getValue('agreeTerms'),
    });
    wizard.prev();
  };

  return (
    <div style="animation: slideIn 0.3s ease-out;">
      <div style="text-align: center; margin-bottom: 2rem;">
        <h2 style="font-size: 1.375rem; font-weight: 700; color: #f5f5f5; margin-bottom: 0.375rem;">Tell us about yourself</h2>
        <p style="font-size: 0.8125rem; color: #666;">Set up your public profile</p>
      </div>

      <form onSubmit={onSubmit} style="display: flex; flex-direction: column; gap: 1.25rem;">
        {/* Full Name */}
        <div>
          <label style={labelStyle}>Full name</label>
          <input
            {...fullNameField}
            type="text"
            placeholder="John Doe"
            style={inputStyle}
            onFocus={focusInput}
            onBlur={(e) => {
              fullNameField.onBlur();
              blurInput(e, formState.errors.fullName);
            }}
          />
          {() => {
            const errors = formState.errors;
            return errors.fullName ? (
              <span style={errorStyle}>{errors.fullName.message}</span>
            ) : null;
          }}
        </div>

        {/* Username */}
        <div>
          <label style={labelStyle}>Username</label>
          <div style="position: relative;">
            <span style="position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); color: #555; font-size: 0.875rem; pointer-events: none;">@</span>
            <input
              {...usernameField}
              type="text"
              placeholder="johndoe"
              style={inputStyle + ' padding-left: 2rem;'}
              onFocus={focusInput}
              onBlur={(e) => {
                usernameField.onBlur();
                blurInput(e, formState.errors.username);
              }}
            />
          </div>
          {() => {
            const errors = formState.errors;
            return errors.username ? (
              <span style={errorStyle}>{errors.username.message}</span>
            ) : null;
          }}
        </div>

        {/* Bio */}
        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.375rem;">
            <label style="font-size: 0.8125rem; font-weight: 500; color: #ccc;">Bio <span style="color: #555; font-weight: 400;">(optional)</span></label>
            {() => {
              const val = getValue('bio') || '';
              const len = val.length;
              return (
                <span style={`font-size: 0.6875rem; ${len > 200 ? 'color: #fca5a5;' : 'color: #555;'}`}>
                  {len}/200
                </span>
              );
            }}
          </div>
          <textarea
            {...bioField}
            placeholder="Tell us a bit about yourself..."
            rows="3"
            style={inputStyle + ' resize: vertical; min-height: 80px;'}
            onFocus={focusInput}
            onBlur={(e) => {
              bioField.onBlur();
              blurInput(e, formState.errors.bio);
            }}
          />
          {() => {
            const errors = formState.errors;
            return errors.bio ? (
              <span style={errorStyle}>{errors.bio.message}</span>
            ) : null;
          }}
        </div>

        {/* Role */}
        <div>
          <label style={labelStyle}>Role</label>
          <select
            {...roleField}
            style={inputStyle + ' cursor: pointer; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23666\' stroke-width=\'2\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 1rem center;'}
            onFocus={focusInput}
            onBlur={(e) => {
              roleField.onBlur();
              blurInput(e, formState.errors.role);
            }}
          >
            <option value="" disabled>Select your role</option>
            <option value="Developer">Developer</option>
            <option value="Designer">Designer</option>
            <option value="Manager">Manager</option>
            <option value="Other">Other</option>
          </select>
          {() => {
            const errors = formState.errors;
            return errors.role ? (
              <span style={errorStyle}>{errors.role.message}</span>
            ) : null;
          }}
        </div>

        {/* Agree to Terms */}
        <div>
          <label style="display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer;">
            <input
              type="checkbox"
              {...agreeTermsField}
              style="margin-top: 0.125rem; width: 1.125rem; height: 1.125rem; accent-color: #3b82f6; cursor: pointer;"
            />
            <span style="font-size: 0.8125rem; color: #999; line-height: 1.4;">
              I agree to the <span style="color: #3b82f6; text-decoration: underline;">Terms of Service</span> and{' '}
              <span style="color: #3b82f6; text-decoration: underline;">Privacy Policy</span>
            </span>
          </label>
          {() => {
            const errors = formState.errors;
            return errors.agreeTerms ? (
              <span style={errorStyle + ' margin-left: 1.875rem;'}>{errors.agreeTerms.message}</span>
            ) : null;
          }}
        </div>

        {/* Buttons */}
        <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem;">
          <button
            type="button"
            onClick={handleBack}
            style="flex: 1; padding: 0.75rem; background: #1a1a1a; color: #ccc; border: 1px solid #2a2a2a; border-radius: 0.625rem; font-size: 0.9375rem; font-weight: 500; cursor: pointer; transition: all 0.2s;"
            onMouseEnter={(e) => { e.target.style.background = '#222'; e.target.style.borderColor = '#444'; }}
            onMouseLeave={(e) => { e.target.style.background = '#1a1a1a'; e.target.style.borderColor = '#2a2a2a'; }}
          >
            Back
          </button>
          <button
            type="submit"
            style="flex: 2; padding: 0.75rem; background: #3b82f6; color: white; border: none; border-radius: 0.625rem; font-size: 0.9375rem; font-weight: 600; cursor: pointer; transition: background 0.2s;"
            onMouseEnter={(e) => { e.target.style.background = '#2563eb'; }}
            onMouseLeave={(e) => { e.target.style.background = '#3b82f6'; }}
          >
            Continue
          </button>
        </div>
      </form>
    </div>
  );
}
