import { useRef, useEffect, spring } from 'what-framework';

/**
 * AnimatedNumber
 * Animates between old and new numeric values using a spring.
 * Formats the display based on the metric format type.
 *
 * Props:
 *   value   - the target numeric value
 *   format  - 'currency' | 'number' | 'percent' | 'rating'
 *   prefix  - optional string prefix (e.g. '$')
 *   suffix  - optional string suffix (e.g. '%', '/5')
 */
export function AnimatedNumber({ value, format, prefix = '', suffix = '' }) {
  // Store the spring instance in a ref so it persists across re-renders
  const springRef = useRef(null);
  // Track the previous value to know when it changed
  const prevValueRef = useRef(value);

  // Create the spring only once
  if (!springRef.current) {
    springRef.current = spring(value, {
      stiffness: 120,
      damping: 14,
      mass: 1,
      precision: 0.01,
    });
  }

  // When value changes, animate to the new target
  useEffect(() => {
    if (springRef.current && prevValueRef.current !== value) {
      springRef.current.set(value);
      prevValueRef.current = value;
    }
  }, [value]);

  function formatValue(raw) {
    switch (format) {
      case 'currency':
        return prefix + raw.toLocaleString('en-US', {
          minimumFractionDigits: raw % 1 !== 0 ? 2 : 0,
          maximumFractionDigits: 2,
        }) + suffix;
      case 'number':
        return prefix + Math.round(raw).toLocaleString('en-US') + suffix;
      case 'percent':
        return prefix + raw.toFixed(1) + suffix;
      case 'rating':
        return prefix + raw.toFixed(1) + suffix;
      default:
        return prefix + raw.toFixed(0) + suffix;
    }
  }

  return (
    <span style={{
      fontVariantNumeric: 'tabular-nums',
      fontWeight: '700',
      fontSize: '2rem',
      lineHeight: '1',
      color: '#f0f0f0',
    }}>
      {() => formatValue(springRef.current.current())}
    </span>
  );
}
