import { useSignal, useForm, rules, simpleResolver, useContext } from 'what-framework';
import { WizardContext } from '../context/WizardContext';
import { inputStyle, labelStyle, errorStyle, focusInput, blurInput } from '../utils/form-styles';

export function StepAccount() {
  const wizard = useContext(WizardContext);
  const showPassword = useSignal(false);
  const showConfirm = useSignal(false);

  // Restore previously saved data
  const savedData = wizard.getState().data;

  const { register, handleSubmit, formState } = useForm({
    defaultValues: {
      email: savedData.email || '',
      password: savedData.password || '',
      confirmPassword: savedData.confirmPassword || '',
    },
    mode: 'onBlur',
    resolver: simpleResolver({
      email: [
        rules.required('Email is required'),
        rules.email('Please enter a valid email address'),
      ],
      password: [
        rules.required('Password is required'),
        rules.minLength(8, 'Password must be at least 8 characters'),
      ],
      confirmPassword: [
        rules.required('Please confirm your password'),
        rules.match('password', 'Passwords do not match'),
      ],
    }),
  });

  const emailField = register('email');
  const passwordField = register('password');
  const confirmPasswordField = register('confirmPassword');

  const onSubmit = handleSubmit((values) => {
    wizard.saveData({
      email: values.email,
      password: values.password,
      confirmPassword: values.confirmPassword,
    });
    wizard.next();
  });

  return (
    <div style="animation: slideIn 0.3s ease-out;">
      <div style="text-align: center; margin-bottom: 2rem;">
        <h2 style="font-size: 1.375rem; font-weight: 700; color: #f5f5f5; margin-bottom: 0.375rem;">Create your account</h2>
        <p style="font-size: 0.8125rem; color: #666;">Enter your email and set a secure password</p>
      </div>

      <form onsubmit={onSubmit} style="display: flex; flex-direction: column; gap: 1.25rem;">
        {/* Email */}
        <div>
          <label style={labelStyle}>Email address</label>
          <input
            {...emailField}
            type="email"
            placeholder="you@example.com"
            style={inputStyle}
            onfocus={focusInput}
            onblur={(e) => {
              emailField.onBlur();
              blurInput(e, formState.errors.email);
            }}
          />
          {() => {
            const errors = formState.errors;
            return errors.email ? (
              <span style={errorStyle}>{errors.email.message}</span>
            ) : null;
          }}
        </div>

        {/* Password */}
        <div>
          <label style={labelStyle}>Password</label>
          <div style="position: relative;">
            <input
              {...passwordField}
              type={showPassword() ? 'text' : 'password'}
              placeholder="At least 8 characters"
              style={inputStyle + ' padding-right: 3rem;'}
              onfocus={focusInput}
              onblur={(e) => {
                passwordField.onBlur();
                blurInput(e, formState.errors.password);
              }}
            />
            <button
              type="button"
              onclick={() => showPassword(!showPassword())}
              style="position: absolute; right: 0.75rem; top: 50%; transform: translateY(-50%); background: none; border: none; color: #666; cursor: pointer; padding: 0.25rem; font-size: 0.75rem; transition: color 0.2s;"
              onmouseenter={(e) => { e.target.style.color = '#e5e5e5'; }}
              onmouseleave={(e) => { e.target.style.color = '#666'; }}
            >
              {() => showPassword() ? 'Hide' : 'Show'}
            </button>
          </div>
          {() => {
            const errors = formState.errors;
            return errors.password ? (
              <span style={errorStyle}>{errors.password.message}</span>
            ) : null;
          }}
        </div>

        {/* Confirm Password */}
        <div>
          <label style={labelStyle}>Confirm password</label>
          <div style="position: relative;">
            <input
              {...confirmPasswordField}
              type={showConfirm() ? 'text' : 'password'}
              placeholder="Re-enter your password"
              style={inputStyle + ' padding-right: 3rem;'}
              onfocus={focusInput}
              onblur={(e) => {
                confirmPasswordField.onBlur();
                blurInput(e, formState.errors.confirmPassword);
              }}
            />
            <button
              type="button"
              onclick={() => showConfirm(!showConfirm())}
              style="position: absolute; right: 0.75rem; top: 50%; transform: translateY(-50%); background: none; border: none; color: #666; cursor: pointer; padding: 0.25rem; font-size: 0.75rem; transition: color 0.2s;"
              onmouseenter={(e) => { e.target.style.color = '#e5e5e5'; }}
              onmouseleave={(e) => { e.target.style.color = '#666'; }}
            >
              {() => showConfirm() ? 'Hide' : 'Show'}
            </button>
          </div>
          {() => {
            const errors = formState.errors;
            return errors.confirmPassword ? (
              <span style={errorStyle}>{errors.confirmPassword.message}</span>
            ) : null;
          }}
        </div>

        {/* Submit */}
        <button
          type="submit"
          style="width: 100%; padding: 0.75rem; background: #3b82f6; color: white; border: none; border-radius: 0.625rem; font-size: 0.9375rem; font-weight: 600; cursor: pointer; transition: background 0.2s; margin-top: 0.5rem;"
          onmouseenter={(e) => { e.target.style.background = '#2563eb'; }}
          onmouseleave={(e) => { e.target.style.background = '#3b82f6'; }}
        >
          Continue
        </button>
      </form>
    </div>
  );
}
