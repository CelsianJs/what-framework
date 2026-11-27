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

/** `TValues` is the form's values type, given to useForm or inferred from its defaultValues. */
export interface FormState<TValues extends object = Record<string, any>> {
  readonly values: TValues;
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

/** What unregister() keeps of a field it forgets (React Hook Form's options). */
export interface UnregisterOptions {
  keepValue?: boolean;
  keepError?: boolean;
  keepTouched?: boolean;
  /** Keep the field's default, so a later reset(), or the field registered again, starts from it. A form or field with shouldUnregister keeps it. */
  keepDefaultValue?: boolean;
}

/** A form's state as useFieldArray works with it: `useForm().control`. */
export interface FormControl {
  /** @internal */
  x: (make: (...args: any[]) => any) => any;
}

/**
 * A field's name is a path: `register('vehicles.0.vin')` reads and writes
 * `values.vehicles[0].vin`, so `values` and what the submit handler gets are
 * nested. `errors`, `touched` and `dirtyFields` are keyed by the field's name
 * (`'vehicles.0.vin'`), as zodResolver reports a nested issue.
 */
export interface UseFormReturn<TValues extends object = Record<string, any>> {
  /** `options.shouldUnregister` forgets the field when the component (or scope) that registered it goes. */
  register: (name: string, options?: Record<string, any>) => RegisterProps;
  /**
   * Forget fields, or every field: their values (and defaults), errors and
   * touched state, each unless the options keep it. A validation of one still
   * in flight never lands.
   */
  unregister: (name?: string | readonly string[], options?: UnregisterOptions) => void;
  control: FormControl;
  handleSubmit: (
    onValid: (values: TValues) => void | Promise<void>,
    onInvalid?: (errors: Record<string, FieldError>) => void,
  ) => (e?: Event) => Promise<void>;
  setValue: (name: string, value: any, options?: Record<string, any>) => void;
  getValue: (name: string) => any;
  setError: (name: string, error: FieldError | null) => void;
  clearError: (name: string) => void;
  clearErrors: () => void;
  /** Back to the defaults, or to `newValues`, which become the defaults that dirtyFields measures from (React Hook Form's reset). */
  reset: (newValues?: Partial<TValues>) => void;
  watch: (name?: string) => Computed<any>;
  validate: (fieldName?: string) => Promise<boolean>;
  formState: FormState<TValues>;
}

/**
 * `useForm<LoginValues>()` types the values the submit handler, formState.values
 * and reset() take; without it they are inferred from `defaultValues`, and
 * without either they are Record<string, any>.
 */
export function useForm<TValues extends object = Record<string, any>>(options?: {
  defaultValues?: Partial<TValues>;
  mode?: 'onSubmit' | 'onChange' | 'onBlur';
  /** Forget each field when the component (or scope) that registered it goes, keeping its default for when it is registered again. */
  shouldUnregister?: boolean;
  reValidateMode?: 'onChange' | 'onBlur';
  /**
   * Given every value; for one field's own validation (a keystroke in
   * `mode: 'onChange'`), also `{ names: [field] }`, so a resolver can check
   * that field alone.
   */
  resolver?: (values: Record<string, any>, context?: undefined, options?: ResolverOptions) => Promise<{ values: Record<string, any>; errors: Record<string, FieldError> }>;
}): UseFormReturn<TValues>;

/** What a resolver is told about a validation: `names` is set when it is for those fields only. */
export interface ResolverOptions {
  names?: string[];
}

/**
 * The items of an array field (React Hook Form's useFieldArray). `fields()`
 * lists them, each with an `id` to key its row by; an item's values, errors
 * and touched state move with it, and a removed item's go with it. A field
 * registered in a row (`register(\`vehicles.${index}.vin\`)`) keeps its item
 * while rows move around it.
 */
export interface UseFieldArrayReturn<TItem extends object = Record<string, any>> {
  fields: Computed<Array<TItem & { id: string }>>;
  append: (value: TItem | TItem[]) => void;
  prepend: (value: TItem | TItem[]) => void;
  insert: (index: number, value: TItem | TItem[]) => void;
  /** The items at these indexes, or every item. */
  remove: (index?: number | number[]) => void;
  move: (from: number, to: number) => void;
  swap: (indexA: number, indexB: number) => void;
  /** The item at `index` becomes a new item with these values: its row is built again. */
  update: (index: number, value: TItem) => void;
  replace: (values: TItem[]) => void;
}

export function useFieldArray<TItem extends object = Record<string, any>>(
  options: { control: FormControl; name: string } | { form: { control: FormControl }; name: string },
): UseFieldArrayReturn<TItem>;

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
