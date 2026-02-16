import { useSignal } from 'what-framework';

export function PreviewForm() {
  const name = useSignal('');
  const email = useSignal('');
  const role = useSignal('developer');
  const agreed = useSignal(false);
  const showError = useSignal(false);
  const submitted = useSignal(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name().trim() || !email().trim()) {
      showError(true);
      submitted(false);
      return;
    }
    showError(false);
    submitted(true);
    // Reset after 2 seconds
    setTimeout(() => submitted(false), 2000);
  };

  return (
    <div style="
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: var(--spacing);
      transition: all 0.3s;
    ">
      <h3 style="font-size: 1rem; font-weight: 600; color: var(--text); margin-bottom: var(--spacing);">
        Preview Form
      </h3>

      <form onsubmit={handleSubmit} style="display: flex; flex-direction: column; gap: var(--spacing);">
        {/* Name Input */}
        <div style="display: flex; flex-direction: column; gap: 0.375rem;">
          <label style="font-size: 0.8125rem; font-weight: 500; color: var(--text);">
            Name
          </label>
          <input
            type="text"
            placeholder="Enter your name"
            value={name()}
            oninput={(e) => { name(e.target.value); showError(false); }}
            style="
              background: var(--bg);
              border: 1px solid var(--border);
              border-radius: var(--radius);
              padding: 0.625rem 0.75rem;
              color: var(--text);
              font-size: 0.875rem;
              outline: none;
              transition: border-color 0.2s;
              width: 100%;
            "
            onfocus={(e) => { e.target.style.borderColor = 'var(--primary)'; }}
            onblur={(e) => { e.target.style.borderColor = 'var(--border)'; }}
          />
        </div>

        {/* Email Input */}
        <div style="display: flex; flex-direction: column; gap: 0.375rem;">
          <label style="font-size: 0.8125rem; font-weight: 500; color: var(--text);">
            Email
          </label>
          <input
            type="email"
            placeholder="you@example.com"
            value={email()}
            oninput={(e) => { email(e.target.value); showError(false); }}
            style={`
              background: var(--bg);
              border: 1px solid ${showError() && !email().trim() ? 'var(--error)' : 'var(--border)'};
              border-radius: var(--radius);
              padding: 0.625rem 0.75rem;
              color: var(--text);
              font-size: 0.875rem;
              outline: none;
              transition: border-color 0.2s;
              width: 100%;
            `}
            onfocus={(e) => { e.target.style.borderColor = 'var(--primary)'; }}
            onblur={(e) => {
              e.target.style.borderColor = showError() && !email().trim() ? 'var(--error)' : 'var(--border)';
            }}
          />
          {() => showError() && !email().trim() ? (
            <span style="font-size: 0.75rem; color: var(--error);">
              Email is required
            </span>
          ) : null}
        </div>

        {/* Role Select */}
        <div style="display: flex; flex-direction: column; gap: 0.375rem;">
          <label style="font-size: 0.8125rem; font-weight: 500; color: var(--text);">
            Role
          </label>
          <select
            value={role()}
            onchange={(e) => role(e.target.value)}
            style="
              background: var(--bg);
              border: 1px solid var(--border);
              border-radius: var(--radius);
              padding: 0.625rem 0.75rem;
              color: var(--text);
              font-size: 0.875rem;
              outline: none;
              cursor: pointer;
              width: 100%;
              transition: border-color 0.2s;
            "
          >
            <option value="developer">Developer</option>
            <option value="designer">Designer</option>
            <option value="manager">Manager</option>
            <option value="other">Other</option>
          </select>
        </div>

        {/* Disabled Input Example */}
        <div style="display: flex; flex-direction: column; gap: 0.375rem;">
          <label style="font-size: 0.8125rem; font-weight: 500; color: var(--text-muted);">
            Organization (disabled)
          </label>
          <input
            type="text"
            value="Acme Corp"
            disabled
            style="
              background: var(--bg);
              border: 1px solid var(--border);
              border-radius: var(--radius);
              padding: 0.625rem 0.75rem;
              color: var(--text-muted);
              font-size: 0.875rem;
              opacity: 0.5;
              cursor: not-allowed;
              width: 100%;
            "
          />
        </div>

        {/* Checkbox */}
        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
          <input
            type="checkbox"
            checked={agreed()}
            onchange={(e) => agreed(e.target.checked)}
            style="
              accent-color: var(--primary);
              width: 1rem;
              height: 1rem;
              cursor: pointer;
            "
          />
          <span style="font-size: 0.8125rem; color: var(--text);">
            I agree to the terms and conditions
          </span>
        </label>

        {/* Error Message */}
        {() => showError() ? (
          <div style="
            background: color-mix(in srgb, var(--error), transparent 88%);
            border: 1px solid var(--error);
            border-radius: var(--radius);
            padding: 0.625rem 0.75rem;
            color: var(--error);
            font-size: 0.8125rem;
          ">
            Please fill in all required fields.
          </div>
        ) : null}

        {/* Success Message */}
        {() => submitted() ? (
          <div style="
            background: color-mix(in srgb, var(--success), transparent 88%);
            border: 1px solid var(--success);
            border-radius: var(--radius);
            padding: 0.625rem 0.75rem;
            color: var(--success);
            font-size: 0.8125rem;
          ">
            Form submitted successfully!
          </div>
        ) : null}

        {/* Buttons */}
        <div style="display: flex; gap: 0.75rem;">
          <button
            type="submit"
            style="
              background: var(--primary);
              color: #fff;
              border: none;
              border-radius: var(--radius);
              padding: 0.625rem 1.5rem;
              font-size: 0.875rem;
              font-weight: 500;
              transition: opacity 0.2s;
            "
            onmouseenter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
            onmouseleave={(e) => { e.currentTarget.style.opacity = '1'; }}
          >
            Submit
          </button>
          <button
            type="button"
            style="
              background: transparent;
              color: var(--text-muted);
              border: 1px solid var(--border);
              border-radius: var(--radius);
              padding: 0.625rem 1.5rem;
              font-size: 0.875rem;
              font-weight: 500;
              transition: all 0.2s;
            "
            onclick={() => {
              name('');
              email('');
              role('developer');
              agreed(false);
              showError(false);
              submitted(false);
            }}
            onmouseenter={(e) => {
              e.currentTarget.style.borderColor = 'var(--text-muted)';
              e.currentTarget.style.color = 'var(--text)';
            }}
            onmouseleave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--text-muted)';
            }}
          >
            Reset
          </button>
          <button
            type="button"
            disabled
            style="
              background: var(--surface);
              color: var(--text-muted);
              border: 1px solid var(--border);
              border-radius: var(--radius);
              padding: 0.625rem 1.5rem;
              font-size: 0.875rem;
              font-weight: 500;
              opacity: 0.5;
              cursor: not-allowed;
            "
          >
            Disabled
          </button>
        </div>
      </form>
    </div>
  );
}
