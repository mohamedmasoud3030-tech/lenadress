import { generateId } from '../../services/localDatabase';

/**
 * Creates a unique key identifying one form submission.
 *
 * Uses the same crypto-backed id generator as persisted records, so it is both
 * collision-safe and free of pseudorandom-number warnings.
 */
export function createSubmissionKey(prefix: string): string {
  return `${prefix}-${generateId()}`;
}
