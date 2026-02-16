export function PreviewCard() {
  return (
    <div style="
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      transition: all 0.3s;
    ">
      {/* Card Header with gradient */}
      <div style="
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        padding: calc(var(--spacing) * 1.5);
      ">
        <h2 style="color: #fff; font-size: 1.25rem; font-weight: 700; margin-bottom: 0.25rem;">
          Preview Card
        </h2>
        <p style="color: rgba(255,255,255,0.8); font-size: 0.875rem;">
          This card demonstrates your theme in action
        </p>
      </div>

      {/* Card Body */}
      <div style="padding: var(--spacing);">
        <p style="color: var(--text); font-size: 0.9375rem; line-height: 1.6; margin-bottom: var(--spacing);">
          The colors, border radius, and spacing you configure on the left are applied in real time to these preview components. Every element uses CSS custom properties driven by your theme signals.
        </p>

        {/* Badges */}
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: var(--spacing);">
          <span style="
            background: var(--primary);
            color: #fff;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 600;
          ">
            Primary
          </span>
          <span style="
            background: var(--secondary);
            color: #fff;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 600;
          ">
            Secondary
          </span>
          <span style="
            background: var(--success);
            color: #fff;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 600;
          ">
            Success
          </span>
          <span style="
            background: var(--warning);
            color: #fff;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 600;
          ">
            Warning
          </span>
          <span style="
            background: var(--error);
            color: #fff;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 600;
          ">
            Error
          </span>
        </div>

        {/* Stats Row */}
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: calc(var(--spacing) * 0.75); margin-bottom: var(--spacing);">
          <div style="
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: calc(var(--spacing) * 0.75);
            text-align: center;
          ">
            <div style="font-size: 1.5rem; font-weight: 700; color: var(--primary);">247</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">Tasks</div>
          </div>
          <div style="
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: calc(var(--spacing) * 0.75);
            text-align: center;
          ">
            <div style="font-size: 1.5rem; font-weight: 700; color: var(--success);">89%</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">Complete</div>
          </div>
          <div style="
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: calc(var(--spacing) * 0.75);
            text-align: center;
          ">
            <div style="font-size: 1.5rem; font-weight: 700; color: var(--warning);">12</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">Pending</div>
          </div>
        </div>

        {/* Action Buttons */}
        <div style="display: flex; gap: 0.75rem;">
          <button
            style="
              background: var(--primary);
              color: #fff;
              border: none;
              border-radius: var(--radius);
              padding: 0.625rem 1.25rem;
              font-size: 0.875rem;
              font-weight: 500;
              flex: 1;
              transition: opacity 0.2s;
            "
            onmouseenter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
            onmouseleave={(e) => { e.currentTarget.style.opacity = '1'; }}
          >
            Primary Action
          </button>
          <button
            style="
              background: transparent;
              color: var(--text);
              border: 1px solid var(--border);
              border-radius: var(--radius);
              padding: 0.625rem 1.25rem;
              font-size: 0.875rem;
              font-weight: 500;
              flex: 1;
              transition: border-color 0.2s;
            "
            onmouseenter={(e) => { e.currentTarget.style.borderColor = 'var(--text-muted)'; }}
            onmouseleave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
          >
            Secondary
          </button>
        </div>
      </div>
    </div>
  );
}
