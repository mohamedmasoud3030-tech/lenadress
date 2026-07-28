import { useId, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/**
 * Shared form primitives.
 *
 * Every screen used to hand-assemble a `<label>` + control + error triple with
 * its own class string. They drifted: some fields were tappable, some were not;
 * some errors were announced, most were not; several controls had no programmatic
 * label at all. These primitives make the correct version the easy one:
 *
 * - the label is always tied to the control by id;
 * - the control is always at least 44px tall (a comfortable tap target);
 * - an error is always `role="alert"` and wired through `aria-describedby`;
 * - `aria-invalid` is set so assistive tech announces the failure;
 * - a hint is described, not just displayed.
 *
 * Rendered font size is handled globally: touch devices render controls at 16px
 * so iOS never force-zooms the page on focus.
 */

const CONTROL_BASE =
  'min-h-11 w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-950 transition placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-slate-500';

const CONTROL_TONES = {
  normal: 'border-slate-300 focus-visible:border-amber-500 focus-visible:ring-amber-500/30',
  invalid: 'border-rose-400 focus-visible:border-rose-500 focus-visible:ring-rose-500/30',
} as const;

export function getControlClassName(invalid = false, extra?: string): string {
  return cn(CONTROL_BASE, invalid ? CONTROL_TONES.invalid : CONTROL_TONES.normal, extra);
}

type FieldShellProps = {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
};

/** Layout and accessibility wrapper shared by every field type. */
export function FormField({ label, error, hint, required, className, children }: FieldShellProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-bold text-slate-700">
        {label}
        {required && <span aria-hidden="true" className="mr-1 text-rose-600">*</span>}
        {required && <span className="sr-only">(مطلوب)</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error && <p id={hintId} className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p id={errorId} role="alert" className="mt-1 text-xs font-bold text-rose-700">{error}</p>}
    </div>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> & {
  label: string;
  error?: string;
  hint?: string;
  fieldClassName?: string;
  controlClassName?: string;
};

export function TextField({ label, error, hint, fieldClassName, controlClassName, required, ...inputProps }: TextFieldProps) {
  return (
    <FormField label={label} error={error} hint={hint} required={required} className={fieldClassName}>
      {({ id, describedBy, invalid }) => (
        <input
          {...inputProps}
          id={id}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={getControlClassName(invalid, controlClassName)}
        />
      )}
    </FormField>
  );
}

type MoneyFieldProps = Omit<TextFieldProps, 'type' | 'inputMode'>;

/**
 * A currency amount. `inputMode="decimal"` gives phones a numeric keypad, which
 * is the difference between a two-second entry and a fight with a full keyboard.
 */
export function MoneyField(props: MoneyFieldProps) {
  return <TextField {...props} type="number" inputMode="decimal" min={props.min ?? 0} step={props.step ?? 0.001} />;
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'> & {
  label: string;
  error?: string;
  hint?: string;
  fieldClassName?: string;
  children: ReactNode;
};

export function SelectField({ label, error, hint, fieldClassName, required, children, ...selectProps }: SelectFieldProps) {
  return (
    <FormField label={label} error={error} hint={hint} required={required} className={fieldClassName}>
      {({ id, describedBy, invalid }) => (
        <select
          {...selectProps}
          id={id}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={getControlClassName(invalid)}
        >
          {children}
        </select>
      )}
    </FormField>
  );
}

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'className'> & {
  label: string;
  error?: string;
  hint?: string;
  fieldClassName?: string;
};

export function TextAreaField({ label, error, hint, fieldClassName, required, ...textAreaProps }: TextAreaFieldProps) {
  return (
    <FormField label={label} error={error} hint={hint} required={required} className={fieldClassName}>
      {({ id, describedBy, invalid }) => (
        <textarea
          {...textAreaProps}
          id={id}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={getControlClassName(invalid, 'min-h-24')}
        />
      )}
    </FormField>
  );
}

/**
 * The action row of a form.
 *
 * Reversed on phones so the primary action sits closest to the thumb, and the
 * submit button always reflects its pending state instead of silently doing
 * nothing on a second tap.
 */
export function FormActions({
  onCancel,
  submitLabel,
  pendingLabel = 'جارٍ الحفظ…',
  isSubmitting = false,
  disabled = false,
  cancelLabel = 'إلغاء',
}: {
  onCancel: () => void;
  submitLabel: string;
  pendingLabel?: string;
  isSubmitting?: boolean;
  disabled?: boolean;
  cancelLabel?: string;
}) {
  return (
    <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
      <button
        type="button"
        onClick={onCancel}
        className="min-h-11 rounded-xl border border-slate-300 px-5 py-2 text-sm font-bold text-slate-700 transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
      >
        {cancelLabel}
      </button>
      <button
        type="submit"
        disabled={disabled || isSubmitting}
        aria-busy={isSubmitting || undefined}
        className="min-h-11 rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
      >
        {isSubmitting ? pendingLabel : submitLabel}
      </button>
    </div>
  );
}
