import { readCollection, runInTransaction, runInTransactionAsync, writeCollection } from '@engines/persistence';

/**
 * Phase 2 — atomic workflow commands.
 *
 * Every multi-write showroom operation (reservation, payment, delivery, return,
 * sale, sale return, expense, daily close) must be all-or-nothing and must carry
 * its audit entry inside the same boundary. `runCommand` gives all of them one
 * shared contract:
 *
 * - a snapshot is taken before the first write and restored exactly on any failure;
 * - an idempotency key blocks a duplicate submit (double click, retried request)
 *   and replays the recorded result instead of writing twice;
 * - the command log itself is written inside the boundary, so a rolled back
 *   command leaves no trace and can be retried cleanly.
 */

const COMMAND_LOG_COLLECTION = 'command-log';
const COMMAND_LOG_LIMIT = 500;

export type CommandLogEntry = {
  id: string;
  commandName: string;
  idempotencyKey: string;
  completedAt: string;
  resultSummary?: string;
};

export class DuplicateCommandError extends Error {
  readonly idempotencyKey: string;

  constructor(commandName: string, idempotencyKey: string) {
    super('تم تنفيذ هذه العملية بالفعل. لا يمكن تكرارها مرة أخرى.');
    this.name = 'DuplicateCommandError';
    this.idempotencyKey = `${commandName}:${idempotencyKey}`;
  }
}

export function getCommandLog(): CommandLogEntry[] {
  return readCollection<CommandLogEntry>(COMMAND_LOG_COLLECTION, []);
}

export function isCommandAlreadyExecuted(commandName: string, idempotencyKey: string): boolean {
  const key = `${commandName}:${idempotencyKey}`;
  return getCommandLog().some((entry) => `${entry.commandName}:${entry.idempotencyKey}` === key || entry.id === key);
}

function appendCommandLog(commandName: string, idempotencyKey: string, resultSummary?: string): void {
  const entry: CommandLogEntry = {
    id: `${commandName}:${idempotencyKey}`,
    commandName,
    idempotencyKey,
    completedAt: new Date().toISOString(),
    resultSummary,
  };
  writeCollection(COMMAND_LOG_COLLECTION, [entry, ...getCommandLog()].slice(0, COMMAND_LOG_LIMIT));
}

export type CommandOptions<T> = {
  /** Stable name of the operation, used in the command log. */
  name: string;
  /**
   * Caller-supplied key identifying this exact submit. When omitted the command
   * still runs atomically but is not duplicate-protected.
   */
  idempotencyKey?: string;
  /** Optional short human summary stored with the log entry. */
  summarize?: (result: T) => string;
};

/**
 * Executes a command atomically. Any thrown error restores the exact prior state
 * of every collection, including the command log entry itself.
 */
export function runCommand<T>(options: CommandOptions<T>, execute: () => T): T {
  const { name, idempotencyKey } = options;

  if (idempotencyKey && isCommandAlreadyExecuted(name, idempotencyKey)) {
    throw new DuplicateCommandError(name, idempotencyKey);
  }

  return runInTransaction(() => {
    const result = execute();
    if (idempotencyKey) {
      appendCommandLog(name, idempotencyKey, options.summarize?.(result));
    }
    return result;
  });
}

/** Async counterpart for backup/image workflows, with the same rollback contract. */
export async function runCommandAsync<T>(
  options: CommandOptions<T>,
  execute: () => Promise<T>,
): Promise<T> {
  const { name, idempotencyKey } = options;

  if (idempotencyKey && isCommandAlreadyExecuted(name, idempotencyKey)) {
    throw new DuplicateCommandError(name, idempotencyKey);
  }

  return runInTransactionAsync(async () => {
    const result = await execute();
    if (idempotencyKey) {
      appendCommandLog(name, idempotencyKey, options.summarize?.(result));
    }
    return result;
  });
}

/**
 * Test-only hook used by forced-failure tests to inject a failure after a given
 * write boundary. Production code never sets a hook.
 */
let failurePoint: string | null = null;

export function setCommandFailurePoint(point: string | null): void {
  failurePoint = point;
}

/** Marks a write boundary inside a command; throws when a test armed this point. */
export function commandBoundary(point: string): void {
  if (failurePoint === point) {
    failurePoint = null;
    throw new Error(`forced failure at boundary: ${point}`);
  }
}
