import { useCallback, useState } from 'react';

export type Step = {
  id: string;
  label: string;
  description?: string;
};

type StepperProps = {
  steps: Step[];
  currentStep: number;
  onStepChange?: (index: number) => void;
  idPrefix?: string;
};

function clampStep(index: number, totalSteps: number): number {
  if (totalSteps <= 0) return 0;
  return Math.max(0, Math.min(index, totalSteps - 1));
}

function getStepStateLabel(isActive: boolean, isCompleted: boolean): string {
  if (isCompleted) return 'خطوة مكتملة';
  if (isActive) return 'الخطوة الحالية';
  return 'خطوة قادمة';
}

function getStepButtonColors(isActive: boolean, isCompleted: boolean): string {
  if (isActive) return 'bg-amber-500 text-white shadow';
  if (isCompleted) return 'bg-emerald-500 text-white';
  return 'bg-slate-200 text-slate-600';
}

function getStepTextColor(isActive: boolean, isCompleted: boolean): string {
  if (isActive) return 'text-amber-700';
  if (isCompleted) return 'text-emerald-700';
  return 'text-slate-500';
}

export function Stepper({ steps, currentStep, onStepChange, idPrefix = 'wizard' }: StepperProps) {
  const safeCurrentStep = clampStep(currentStep, steps.length);
  const activeStep = steps[safeCurrentStep];

  return (
    <nav aria-label="خطوات إنشاء الحجز" className="mb-6">
      {activeStep && (
        <p className="mb-3 text-sm font-bold text-slate-800 sm:hidden" aria-live="polite">
          الخطوة {safeCurrentStep + 1} من {steps.length}: {activeStep.label}
        </p>
      )}
      <ol className="flex min-w-max items-center gap-2 overflow-x-auto pb-2 sm:min-w-0">
        {steps.map((step, index) => {
          const isActive = index === safeCurrentStep;
          const isCompleted = index < safeCurrentStep;
          const isClickable = Boolean(onStepChange) && index <= safeCurrentStep;
          const stepButtonId = `${idPrefix}-step-${step.id}`;
          const stepPanelId = `${idPrefix}-panel-${step.id}`;
          const stateLabel = getStepStateLabel(isActive, isCompleted);
          const buttonColors = getStepButtonColors(isActive, isCompleted);
          const textColor = getStepTextColor(isActive, isCompleted);

          return (
            <li key={step.id} className="flex flex-1 items-center gap-2">
              <button
                id={stepButtonId}
                type="button"
                disabled={!isClickable}
                aria-current={isActive ? 'step' : undefined}
                aria-controls={stepPanelId}
                aria-label={`${stateLabel}: ${step.label}`}
                onClick={() => {
                  if (isClickable) onStepChange?.(index);
                }}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2
                  ${buttonColors}
                  ${isClickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}
                `}
              >
                {isCompleted ? '✓' : index + 1}
              </button>
              <div className="hidden min-w-0 flex-1 sm:block">
                <p className={`truncate text-xs font-bold ${textColor}`}>
                  {step.label}
                </p>
                {step.description && <p className="truncate text-[10px] text-slate-400">{step.description}</p>}
              </div>
              {index < steps.length - 1 && (
                <div aria-hidden="true" className={`mx-1 h-[2px] min-w-6 flex-1 ${isCompleted ? 'bg-emerald-300' : 'bg-slate-200'}`} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function useStepper(totalSteps: number) {
  const [current, setCurrent] = useState(0);
  const next = useCallback(() => setCurrent((step) => clampStep(step + 1, totalSteps)), [totalSteps]);
  const prev = useCallback(() => setCurrent((step) => clampStep(step - 1, totalSteps)), [totalSteps]);
  const goTo = useCallback((index: number) => setCurrent(clampStep(index, totalSteps)), [totalSteps]);
  const reset = useCallback(() => setCurrent(0), []);
  return { current: clampStep(current, totalSteps), next, prev, goTo, reset };
}
