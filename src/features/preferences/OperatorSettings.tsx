import { useMemo, useState } from 'react';
import { Plus, UserRound } from 'lucide-react';
import { Section } from '../../components/shared/Section';
import { SelectField, TextField } from '../../components/shared/FormField';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import {
  DEFAULT_OPERATOR_NAME,
  addOperator,
  archiveOperator,
  getActiveOperators,
  getCurrentOperatorName,
  setCurrentOperatorName,
} from '../operators/operator.service';

/**
 * Who this device attributes actions to.
 *
 * Deliberately not a login: there is no server to authenticate against. It
 * exists so the audit trail can answer "who cancelled this booking" when more
 * than one person works the counter.
 */
export function OperatorSettings() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [current, setCurrent] = useState(() => getCurrentOperatorName());
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const operators = useMemo(() => getActiveOperators(), [refreshToken]);

  const handleAdd = () => {
    setError(null);
    try {
      const operator = addOperator(newName);
      setNewName('');
      setRefreshToken((token) => token + 1);
      setFeedback(`تمت إضافة ${operator.name}.`);
    } catch (reason: unknown) {
      setError(reason);
    }
  };

  const handleSwitch = (name: string) => {
    setCurrent(setCurrentOperatorName(name));
    setFeedback(`سيتم تسجيل العمليات باسم ${name || DEFAULT_OPERATOR_NAME}.`);
  };

  return (
    <Section
      title="المستخدم الحالي"
      description="يُسجَّل اسم من ينفّذ كل عملية في سجل التدقيق. هذا ليس تسجيل دخول ولا يمنع أحداً من الاستخدام."
    >
      {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر حفظ المستخدم." />}
      {feedback && <p role="status" className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{feedback}</p>}

      <div className="flex items-center gap-3 rounded-xl bg-stone-50 p-3">
        <UserRound aria-hidden="true" className="h-5 w-5 shrink-0 text-slate-500" />
        <p className="min-w-0 flex-1 text-sm text-slate-700">
          العمليات تُسجَّل حالياً باسم <b className="text-slate-950">{current}</b>
        </p>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <SelectField label="تبديل المستخدم" value={current} onChange={(event) => handleSwitch(event.target.value)}>
          <option value={DEFAULT_OPERATOR_NAME}>{DEFAULT_OPERATOR_NAME}</option>
          {operators.map((operator) => (
            <option key={operator.id} value={operator.name}>{operator.name}</option>
          ))}
        </SelectField>

        <div className="flex items-end gap-2">
          <TextField
            label="إضافة مستخدم"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="اسم الموظفة"
            fieldClassName="flex-1"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newName.trim()}
            aria-label="إضافة مستخدم"
            className={`mb-0 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white transition hover:bg-slate-800 disabled:opacity-50 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </div>

      {operators.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {operators.map((operator) => (
            <li key={operator.id} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
              {operator.name}
              <button
                type="button"
                onClick={() => { archiveOperator(operator.id); setRefreshToken((token) => token + 1); }}
                aria-label={`إزالة ${operator.name}`}
                className="text-slate-400 transition hover:text-rose-700"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs leading-5 text-slate-500">
        الاختيار محفوظ على هذا الجهاز فقط، فلكل جهاز في المعرض مستخدمه الخاص. أسماء المستخدمين المُزالة تبقى ظاهرة في السجلات القديمة.
      </p>
    </Section>
  );
}
