// What Framework - Form Utilities
// Controlled inputs, validation, and form state management

import { signal, computed, batch, effect } from './reactive.js';
import { h } from './h.js';

// --- useForm Hook ---
// Complete form state management with validation

export function useForm(options = {}) {
  const {
    defaultValues = {},
    mode = 'onSubmit', // 'onSubmit' | 'onChange' | 'onBlur'
    reValidateMode = 'onChange',
    resolver,
  } = options;

  // Per-field signals for granular reactivity (avoids full-form re-renders on each keystroke)
  const fieldSignals = {};
  const errorSignals = {};
  const touchedSignals = {};

  function getFieldSignal(name) {
    if (!fieldSignals[name]) {
      fieldSignals[name] = signal(defaultValues[name] ?? '');
    }
    return fieldSignals[name];
  }

  function getErrorSignal(name) {
    if (!errorSignals[name]) {
      errorSignals[name] = signal(null);
    }
    return errorSignals[name];
  }

  function getTouchedSignal(name) {
    if (!touchedSignals[name]) {
      touchedSignals[name] = signal(false);
    }
    return touchedSignals[name];
  }

  // Aggregate signals for bulk operations
  const isDirty = signal(false);
  const isSubmitting = signal(false);
  const isSubmitted = signal(false);
  const submitCount = signal(0);

  // Helper: get all current values as a plain object
  function getAllValues() {
    const result = { ...defaultValues };
    for (const [name, sig] of Object.entries(fieldSignals)) {
      result[name] = sig.peek();
    }
    return result;
  }

  // Helper: get all current errors as a plain object
  function getAllErrors() {
    const result = {};
    for (const [name, sig] of Object.entries(errorSignals)) {
      const err = sig.peek();
      if (err) result[name] = err;
    }
    return result;
  }

  // Computed states
  const isValid = computed(() => {
    for (const sig of Object.values(errorSignals)) {
      if (sig()) return false;
    }
    return true;
  });

  const dirtyFields = computed(() => {
    const dirty = {};
    for (const [name, sig] of Object.entries(fieldSignals)) {
      if (sig() !== (defaultValues[name] ?? '')) {
        dirty[name] = true;
      }
    }
    return dirty;
  });

  // Validation
  async function validate(fieldName) {
    if (!resolver) return true;

    const result = await resolver(getAllValues());

    if (fieldName) {
      // Validate single field — only update that field's error signal
      const errSig = getErrorSignal(fieldName);
      if (result.errors[fieldName]) {
        errSig.set(result.errors[fieldName]);
        return false;
      } else {
        errSig.set(null);
        return true;
      }
    } else {
      // Validate all fields
      batch(() => {
        // Clear existing errors
        for (const sig of Object.values(errorSignals)) {
          sig.set(null);
        }
        // Set new errors
        for (const [name, err] of Object.entries(result.errors || {})) {
          getErrorSignal(name).set(err);
        }
      });
      return Object.keys(result.errors || {}).length === 0;
    }
  }

  // Register a field — only subscribes to THIS field's signal
  function register(name, options = {}) {
    const fieldSig = getFieldSignal(name);
    return {
      name,
      // Use getter so value is always fresh, even if register result is cached
      get value() { return fieldSig(); },
      onInput: (e) => {
        const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        setValue(name, value);

        if (mode === 'onChange' || (isSubmitted.peek() && reValidateMode === 'onChange')) {
          validate(name);
        }
      },
      onBlur: () => {
        getTouchedSignal(name).set(true);

        if (mode === 'onBlur' || (isSubmitted.peek() && reValidateMode === 'onBlur')) {
          validate(name);
        }
      },
      onFocus: () => {},
      ref: options.ref,
    };
  }

  // Set single field value — only triggers re-render for components reading this field
  function setValue(name, value, options = {}) {
    const { shouldValidate = false, shouldDirty = true } = options;

    getFieldSignal(name).set(value);
    if (shouldDirty) isDirty.set(true);

    if (shouldValidate) {
      validate(name);
    }
  }

  // Get single field value
  function getValue(name) {
    return getFieldSignal(name)();
  }

  // Set error for a field
  function setError(name, error) {
    getErrorSignal(name).set(error);
  }

  // Clear error for a field
  function clearError(name) {
    getErrorSignal(name).set(null);
  }

  // Clear all errors
  function clearErrors() {
    batch(() => {
      for (const sig of Object.values(errorSignals)) {
        sig.set(null);
      }
    });
  }

  // Reset form
  function reset(newValues = defaultValues) {
    batch(() => {
      for (const [name, sig] of Object.entries(fieldSignals)) {
        sig.set(newValues[name] ?? '');
      }
      for (const sig of Object.values(errorSignals)) {
        sig.set(null);
      }
      for (const sig of Object.values(touchedSignals)) {
        sig.set(false);
      }
      isDirty.set(false);
      isSubmitted.set(false);
    });
  }

  // Handle submit
  function handleSubmit(onValid, onInvalid) {
    return async (e) => {
      if (e) e.preventDefault();

      isSubmitting.set(true);
      isSubmitted.set(true);
      submitCount.set(submitCount.peek() + 1);

      const isFormValid = await validate();

      if (isFormValid) {
        await onValid(getAllValues());
      } else if (onInvalid) {
        onInvalid(getAllErrors());
      }

      isSubmitting.set(false);
    };
  }

  // Watch a field — returns a computed that subscribes only to this field
  function watch(name) {
    if (name) {
      return computed(() => getFieldSignal(name)());
    }
    // Watch all: return a computed that reads all field signals
    return computed(() => getAllValues());
  }

  return {
    register,
    handleSubmit,
    setValue,
    getValue,
    setError,
    clearError,
    clearErrors,
    reset,
    watch,
    validate,
    // Form state — uses getters for errors/touched to enable per-field granularity
    formState: {
      get values() { return getAllValues(); },
      get errors() { return getAllErrors(); },
      get touched() {
        const result = {};
        for (const [name, sig] of Object.entries(touchedSignals)) {
          if (sig()) result[name] = true;
        }
        return result;
      },
      isDirty: () => isDirty(),
      isValid,
      isSubmitting: () => isSubmitting(),
      isSubmitted: () => isSubmitted(),
      submitCount: () => submitCount(),
      dirtyFields,
    },
  };
}

// --- Validation Resolvers ---

export function zodResolver(schema) {
  return async (values) => {
    try {
      const result = await schema.parseAsync(values);
      return { values: result, errors: {} };
    } catch (e) {
      const errors = {};
      for (const issue of e.errors || []) {
        const path = issue.path.join('.');
        if (!errors[path]) {
          errors[path] = { type: issue.code, message: issue.message };
        }
      }
      return { values: {}, errors };
    }
  };
}

export function yupResolver(schema) {
  return async (values) => {
    try {
      const result = await schema.validate(values, { abortEarly: false });
      return { values: result, errors: {} };
    } catch (e) {
      const errors = {};
      for (const err of e.inner || []) {
        if (!errors[err.path]) {
          errors[err.path] = { type: err.type, message: err.message };
        }
      }
      return { values: {}, errors };
    }
  };
}

// Simple validation resolver
export function simpleResolver(rules) {
  return async (values) => {
    const errors = {};

    for (const [field, fieldRules] of Object.entries(rules)) {
      const value = values[field];

      for (const rule of fieldRules) {
        const error = rule(value, values);
        if (error) {
          errors[field] = { type: 'validation', message: error };
          break;
        }
      }
    }

    return { values, errors };
  };
}

// Built-in validation rules
export const rules = {
  required: (message = 'This field is required') => (value) => {
    if (value === undefined || value === null || value === '') {
      return message;
    }
  },

  minLength: (min, message) => (value) => {
    if (typeof value === 'string' && value.length < min) {
      return message || `Must be at least ${min} characters`;
    }
  },

  maxLength: (max, message) => (value) => {
    if (typeof value === 'string' && value.length > max) {
      return message || `Must be at most ${max} characters`;
    }
  },

  min: (min, message) => (value) => {
    if (typeof value === 'number' && value < min) {
      return message || `Must be at least ${min}`;
    }
  },

  max: (max, message) => (value) => {
    if (typeof value === 'number' && value > max) {
      return message || `Must be at most ${max}`;
    }
  },

  pattern: (regex, message = 'Invalid format') => (value) => {
    if (typeof value === 'string' && !regex.test(value)) {
      return message;
    }
  },

  email: (message = 'Invalid email address') => (value) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (typeof value === 'string' && !emailRegex.test(value)) {
      return message;
    }
  },

  url: (message = 'Invalid URL') => (value) => {
    try {
      if (typeof value === 'string' && value) {
        new URL(value);
      }
    } catch {
      return message;
    }
  },

  match: (field, message) => (value, values) => {
    if (value !== values[field]) {
      return message || `Must match ${field}`;
    }
  },

  custom: (validator) => validator,
};

// --- useField Hook ---
// Individual field control

export function useField(name, options = {}) {
  const { validate: validateFn, defaultValue = '' } = options;

  const value = signal(defaultValue);
  const error = signal(null);
  const isTouched = signal(false);
  const isDirty = signal(false);

  async function validate() {
    if (!validateFn) return true;
    const result = await validateFn(value.peek());
    error.set(result || null);
    return !result;
  }

  return {
    name,
    value: () => value(),
    error: () => error(),
    isTouched: () => isTouched(),
    isDirty: () => isDirty(),
    setValue: (v) => {
      value.set(v);
      isDirty.set(true);
    },
    setError: (e) => error.set(e),
    validate,
    reset: () => {
      value.set(defaultValue);
      error.set(null);
      isTouched.set(false);
      isDirty.set(false);
    },
    inputProps: () => ({
      name,
      value: value(),
      onInput: (e) => {
        value.set(e.target.value);
        isDirty.set(true);
      },
      onBlur: () => {
        isTouched.set(true);
        validate();
      },
    }),
  };
}

// --- Controlled Input Components ---

export function Input(props) {
  const { register, error, ...rest } = props;
  const registered = register ? register(props.name) : {};

  return h('input', {
    ...rest,
    ...registered,
    'aria-invalid': error ? 'true' : undefined,
  });
}

export function Textarea(props) {
  const { register, error, ...rest } = props;
  const registered = register ? register(props.name) : {};

  return h('textarea', {
    ...rest,
    ...registered,
    'aria-invalid': error ? 'true' : undefined,
  });
}

export function Select(props) {
  const { register, error, children, ...rest } = props;
  const registered = register ? register(props.name) : {};

  return h('select', {
    ...rest,
    ...registered,
    'aria-invalid': error ? 'true' : undefined,
  }, children);
}

export function Checkbox(props) {
  const { register, ...rest } = props;
  const registered = register ? register(props.name) : {};

  return h('input', {
    type: 'checkbox',
    ...rest,
    ...registered,
    checked: registered.value,
  });
}

export function Radio(props) {
  const { register, value: radioValue, ...rest } = props;
  const registered = register ? register(props.name) : {};

  return h('input', {
    type: 'radio',
    value: radioValue,
    ...rest,
    checked: registered.value === radioValue,
    onChange: (e) => {
      if (e.target.checked && registered.onInput) {
        registered.onInput({ target: { value: radioValue } });
      }
    },
  });
}

// --- Form Error Display ---

export function ErrorMessage({ name, errors, render }) {
  const error = errors ? errors()[name] : null;
  if (!error) return null;

  if (render) {
    return render({ message: error.message, type: error.type });
  }

  return h('span', { class: 'what-error', role: 'alert' }, error.message);
}
