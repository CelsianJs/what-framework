// what-core/form (what-framework/form): form state, validation and bound fields.
import type { Computed, VNode, VNodeChild } from './index.js';

// --- Forms ---

export interface FieldError {
  type?: string;
  message?: string;
  [key: string]: any;
}

/**
 * What register() actually hands back, which varies by control type. The event
 * handler is LOWERCASE (`onchange`), because that is the key the DOM binding
 * and the merge in <Input>/<Radio> look for; `onInput` was declared here and
 * register() has never defined it, so `register('email').onInput(e)`
 * type-checked and threw at the first keystroke. `onchange` is React's change
 * event, as every onChange is: a text field fires it as the user types.
 *
 * `value` and the checkbox `checked` are getters, and the radio `checked` is a
 * thunk. Compiled JSX's spread (`<input {...register('email')} />`) reads them
 * in its binding, so the input follows setValue and reset. An h() call reads
 * them once: a JavaScript spread (`h('input', { ...register('email') })`)
 * copies the value, so a later setValue does not show; give `value` as an
 * accessor after the spread, or use `Input` (docs/API.md, Forms).
 *
 * A closed type alias rather than an interface: the key set really is closed
 * (this is the whole object register() builds), and closing it is what makes
 * the phantom `onInput` an error again instead of an `any` off an index
 * signature. It must stay a `type`, not an `interface`, because only a type
 * alias gets the implicit index signature that `h('input', register(name))`
 * needs to be assignable to Record<string, any>.
 */
export type RegisterProps = {
  name: string;
  onBlur: () => void;
  onFocus: () => void;
  ref?: any;
  /** text/select/textarea, and the option's own value on a radio. */
  value?: any;
  /** checkbox/radio only. */
  checked?: boolean | (() => boolean);
  /** Every control: each edit of a text field or a textarea, as the user types, a select's pick and a checkbox's or a radio's. */
  onchange?: (e: any) => void;
  /**
   * @deprecated text/select/textarea only: the `onchange` handler, kept for
   * 0.14 code that wires `oninput: register('x').oninput`. Not enumerable, so
   * a spread attaches only `onchange`.
   */
  oninput?: (e: any) => void;
};

export interface FormState {
  readonly values: Record<string, any>;
  readonly errors: Record<string, FieldError>;
  error: (name: string) => FieldError | null;
  readonly touched: Record<string, boolean>;
  isDirty: () => boolean;
  isValid: Computed<boolean>;
  /** True while the resolver is running. Present since resolvers went async; never declared. */
  isValidating: () => boolean;
  isSubmitting: () => boolean;
  isSubmitted: () => boolean;
  submitCount: () => number;
  dirtyFields: Computed<Record<string, boolean>>;
}

export interface UseFormReturn {
  register: (name: string, options?: Record<string, any>) => RegisterProps;
  handleSubmit: (
    onValid: (values: Record<string, any>) => void | Promise<void>,
    onInvalid?: (errors: Record<string, FieldError>) => void,
  ) => (e?: Event) => Promise<void>;
  setValue: (name: string, value: any, options?: Record<string, any>) => void;
  getValue: (name: string) => any;
  setError: (name: string, error: FieldError | null) => void;
  clearError: (name: string) => void;
  clearErrors: () => void;
  reset: (newValues?: Record<string, any>) => void;
  watch: (name?: string) => Computed<any>;
  validate: (fieldName?: string) => Promise<boolean>;
  formState: FormState;
}

export function useForm(options?: {
  defaultValues?: Record<string, any>;
  mode?: 'onSubmit' | 'onChange' | 'onBlur';
  reValidateMode?: 'onChange' | 'onBlur';
  /**
   * Given every value; for one field's own validation (a keystroke in
   * `mode: 'onChange'`), also `{ names: [field] }`, so a resolver can check
   * that field alone.
   */
  resolver?: (values: Record<string, any>, context?: undefined, options?: ResolverOptions) => Promise<{ values: Record<string, any>; errors: Record<string, FieldError> }>;
}): UseFormReturn;

/** What a resolver is told about a validation: `names` is set when it is for those fields only. */
export interface ResolverOptions {
  names?: string[];
}

export function useField(name: string, options?: {
  validate?: (value: any) => string | null | Promise<string | null>;
  defaultValue?: any;
}): {
  name: string;
  value: () => any;
  error: () => string | null;
  isTouched: () => boolean;
  isDirty: () => boolean;
  setValue: (value: any) => void;
  setError: (error: string | null) => void;
  validate: () => Promise<boolean>;
  reset: () => void;
  inputProps: () => Record<string, any>;
};

export const rules: {
  required: (message?: string) => (value: any) => string | void;
  minLength: (min: number, message?: string) => (value: any) => string | void;
  maxLength: (max: number, message?: string) => (value: any) => string | void;
  min: (min: number, message?: string) => (value: any) => string | void;
  max: (max: number, message?: string) => (value: any) => string | void;
  pattern: (regex: RegExp, message?: string) => (value: any) => string | void;
  email: (message?: string) => (value: any) => string | void;
  url: (message?: string) => (value: any) => string | void;
  match: (field: string, message?: string) => (value: any, values: Record<string, any>) => string | void;
  custom: <T extends (...args: any[]) => any>(validator: T) => T;
};

export function simpleResolver(ruleMap: Record<string, Array<(value: any, values: Record<string, any>) => string | void>>):
  (values: Record<string, any>, context?: unknown, options?: ResolverOptions) => Promise<{ values: Record<string, any>; errors: Record<string, FieldError> }>;

export function zodResolver(schema: { parseAsync: (values: any) => Promise<any> }):
  (values: Record<string, any>) => Promise<{ values: Record<string, any>; errors: Record<string, FieldError> }>;

export function yupResolver(schema: { validate: (values: any, options?: any) => Promise<any> }):
  (values: Record<string, any>) => Promise<{ values: Record<string, any>; errors: Record<string, FieldError> }>;

export function Input(props: Record<string, any>): VNode;
export function Textarea(props: Record<string, any>): VNode;
export function Select(props: Record<string, any>): VNode;
export function Checkbox(props: Record<string, any>): VNode;
export function Radio(props: Record<string, any>): VNode;

/**
 * The field's error message, kept current: it appears, changes and goes away
 * with the error. Returns the reactive function that renders it.
 */
export function ErrorMessage(props: {
  name: string;
  formState?: FormState;
  errors?: Record<string, FieldError> | (() => Record<string, FieldError>);
  render?: (args: { message?: string; type?: string }) => VNodeChild;
}): () => VNodeChild;
