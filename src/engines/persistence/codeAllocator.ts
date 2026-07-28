import { getBrowserLocalStorage, type StoragePort } from '@platform/storage';
import { getCollectionKey } from './collectionRegistry';

/**
 * Phase 1.19 — monotonic, collision-safe code allocation.
 *
 * Inventory codes used to be derived from `items.length + 1`, which reused codes
 * after deletion or archiving and collided after restore. The allocator keeps a
 * durable counter inside the canonical `counters` collection (so it is part of
 * backup, restore and desktop persistence) and always reconciles that counter
 * against the highest code currently observable. A code is therefore never
 * reused, even after deletion, archiving, migration, or restore.
 */

export const COUNTERS_COLLECTION = 'counters';

export type CodeCounter = {
  id: string;
  sequence: number;
  updatedAt: string;
};

function getStorage(): StoragePort | null {
  return getBrowserLocalStorage();
}

const memoryCounters = new Map<string, CodeCounter>();

function readCounters(): CodeCounter[] {
  const storage = getStorage();
  if (!storage) return Array.from(memoryCounters.values());

  try {
    const raw = storage.getItem(getCollectionKey(COUNTERS_COLLECTION));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CodeCounter[]) : [];
  } catch {
    return [];
  }
}

function writeCounters(counters: CodeCounter[]): void {
  memoryCounters.clear();
  counters.forEach((counter) => memoryCounters.set(counter.id, counter));

  const storage = getStorage();
  if (!storage) return;
  storage.setItem(getCollectionKey(COUNTERS_COLLECTION), JSON.stringify(counters));
}

export function getCounterSequence(counterId: string): number {
  const counter = readCounters().find((item) => item.id === counterId);
  return counter && Number.isFinite(counter.sequence) ? Math.max(0, Math.trunc(counter.sequence)) : 0;
}

/**
 * Extracts the numeric part of a code such as `DR-014` or legacy `D014`.
 * Returns 0 when the code carries no usable sequence.
 */
export function parseCodeSequence(code: string, prefix: string): number {
  if (typeof code !== 'string') return 0;
  const trimmed = code.trim();
  const normalizedPrefix = prefix.replace(/-$/, '');
  const match = new RegExp(`^${normalizedPrefix}-?(\\d+)$`, 'i').exec(trimmed);
  if (!match) return 0;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : 0;
}

export function formatCode(prefix: string, sequence: number, padding = 3): string {
  const normalizedPrefix = prefix.replace(/-$/, '');
  return `${normalizedPrefix}-${String(sequence).padStart(padding, '0')}`;
}

/**
 * Raises the stored counter so it is never lower than the highest existing code.
 * Called before allocation and after restore/migration.
 */
export function reconcileCounter(counterId: string, prefix: string, existingCodes: Iterable<string>): number {
  const highestExisting = Array.from(existingCodes).reduce(
    (highest, code) => Math.max(highest, parseCodeSequence(code, prefix)),
    0,
  );
  const stored = getCounterSequence(counterId);
  const reconciled = Math.max(stored, highestExisting);

  if (reconciled !== stored) {
    const counters = readCounters().filter((item) => item.id !== counterId);
    counters.push({ id: counterId, sequence: reconciled, updatedAt: new Date().toISOString() });
    writeCounters(counters);
  }

  return reconciled;
}

/**
 * Allocates the next unused code. `existingCodes` must contain every code that
 * is still observable, including archived and sold items, so that no code is
 * ever handed out twice.
 */
export function allocateCode(counterId: string, prefix: string, existingCodes: Iterable<string>, padding = 3): string {
  const codes = new Set(Array.from(existingCodes));
  let sequence = reconcileCounter(counterId, prefix, codes);

  let candidate = '';
  do {
    sequence += 1;
    candidate = formatCode(prefix, sequence, padding);
  } while (codes.has(candidate));

  const counters = readCounters().filter((item) => item.id !== counterId);
  counters.push({ id: counterId, sequence, updatedAt: new Date().toISOString() });
  writeCounters(counters);

  return candidate;
}

export function resetCountersForTesting(): void {
  memoryCounters.clear();
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(getCollectionKey(COUNTERS_COLLECTION));
  } catch {
    // Ignore removal failures during test cleanup.
  }
}
