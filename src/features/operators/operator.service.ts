import { getBrowserLocalStorage } from '@platform/storage';
import { readCollection, writeCollection } from '../../services/localDatabase';

/**
 * Who is operating the app right now.
 *
 * This is **not** authentication. The product is deliberately single-showroom
 * and local-first, with no server and no accounts, so there is nothing to
 * authenticate against and no way to enforce a login. Pretending otherwise
 * would be security theatre.
 *
 * What it does provide is **attribution**: when more than one person works the
 * counter, the audit trail must say who cancelled a booking, who granted a
 * discount, or who wrote a warning about a customer. Without it every entry is
 * anonymous and the log cannot answer the only question it exists for.
 *
 * The active operator is a device-level preference, not showroom data: two
 * phones in the same showroom have different people holding them.
 */

const OPERATORS_COLLECTION = 'operators';
const ACTIVE_OPERATOR_KEY = 'dress-roomshow:active-operator';

export type Operator = {
  id: string;
  name: string;
  /** Retired operators stay listed so old audit entries remain readable. */
  archivedAt?: string;
};

export const DEFAULT_OPERATOR_NAME = 'المعرض';

export function getOperators(): Operator[] {
  return readCollection<Operator>(OPERATORS_COLLECTION, []);
}

export function getActiveOperators(): Operator[] {
  return getOperators().filter((operator) => !operator.archivedAt);
}

export function addOperator(name: string): Operator {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('اسم المستخدم مطلوب.');

  const operators = getOperators();
  if (operators.some((operator) => operator.name === trimmed && !operator.archivedAt)) {
    throw new Error('يوجد مستخدم بنفس الاسم بالفعل.');
  }

  // A readable, stable id: audit entries reference the name, not this.
  const operator: Operator = { id: `op-${Date.now().toString(36)}-${operators.length + 1}`, name: trimmed };
  writeCollection(OPERATORS_COLLECTION, [...operators, operator]);
  return operator;
}

export function archiveOperator(id: string): void {
  const operators = getOperators();
  writeCollection(
    OPERATORS_COLLECTION,
    operators.map((operator) => (operator.id === id ? { ...operator, archivedAt: new Date().toISOString() } : operator)),
  );
}

/**
 * The operator this device is currently attributing actions to.
 *
 * Stored per device through the platform port, so switching on one phone does
 * not change what another phone records.
 */
export function getCurrentOperatorName(): string {
  const storage = getBrowserLocalStorage();
  if (!storage) return DEFAULT_OPERATOR_NAME;
  try {
    const stored = storage.getItem(ACTIVE_OPERATOR_KEY);
    return stored?.trim() || DEFAULT_OPERATOR_NAME;
  } catch {
    return DEFAULT_OPERATOR_NAME;
  }
}

export function setCurrentOperatorName(name: string): string {
  const trimmed = name.trim() || DEFAULT_OPERATOR_NAME;
  const storage = getBrowserLocalStorage();
  if (storage) {
    try {
      storage.setItem(ACTIVE_OPERATOR_KEY, trimmed);
    } catch {
      // A blocked storage must not stop the showroom working.
    }
  }
  return trimmed;
}
