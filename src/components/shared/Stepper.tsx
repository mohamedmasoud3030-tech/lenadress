import { useState } from 'react';

type Step = {
  id: string;
  label: string;
  description?: string;
};

type StepperProps = {
  steps: Step[];
  currentStep: number;
  onStepChange?: (index: number) => void;
};

export function Stepper({ steps, currentStep, onStepChange }: StepperProps) {
  return (
    <div className="mb-6 flex items-center justify-between gap-2 overflow-x-auto pb-2">
      {steps.map((step, index) => {
        const isActive = index === currentStep;
        const isCompleted = index < currentStep;
        const isClickable = onStepChange && index <= currentStep;

        return (
          <div key={step.id} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onStepChange?.(index)}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold transition
                ${isActive ? 'bg-amber-500 text-white shadow' : isCompleted ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}
                ${isClickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}
              `}
            >
              {isCompleted ? '✓' : index + 1}
            </button>
            <div className="hidden min-w-0 flex-1 sm:block">
              <p className={`truncate text-xs font-bold ${isActive ? 'text-amber-700' : isCompleted ? 'text-emerald-700' : 'text-slate-500'}`}>{step.label}</p>
              {step.description && <p className="truncate text-[10px] text-slate-400">{step.description}</p>}
            </div>
            {index < steps.length - 1 && (
              <div className={`mx-1 h-[2px] flex-1 ${isCompleted ? 'bg-emerald-300' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function useStepper(totalSteps: number) {
  const [current, setCurrent] = useState(0);
  const next = () => setCurrent((c) => Math.min(c + 1, totalSteps - 1));
  const prev = () => setCurrent((c) => Math.max(c - 1, 0));
  const goTo = (index: number) => setCurrent(Math.max(0, Math.min(index, totalSteps - 1)));
  return { current, next, prev, goTo, setCurrent };
}
