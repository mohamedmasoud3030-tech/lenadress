import type { PersistenceSnapshot } from '@engines/persistence';

export const SHOWROOM_COMMAND_COMMITTED_EVENT = 'lena:showroom-command-committed';

export type ShowroomCommandCommitted = {
  commandName: string;
  idempotencyKey: string;
  before: PersistenceSnapshot;
  after: PersistenceSnapshot;
};

let operationCounter = 0;

function createOperationKey(commandName: string): string {
  operationCounter = (operationCounter + 1) % Number.MAX_SAFE_INTEGER;
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${operationCounter.toString(36)}`;
  return `${commandName}:${suffix}`.slice(0, 200);
}

export function publishShowroomCommandCommitted(
  commandName: string,
  idempotencyKey: string | undefined,
  before: PersistenceSnapshot,
  after: PersistenceSnapshot,
): void {
  if (
    typeof window === 'undefined'
    || typeof document === 'undefined'
    || !document.documentElement
    || typeof window.dispatchEvent !== 'function'
  ) return;
  const detail: ShowroomCommandCommitted = {
    commandName,
    idempotencyKey: (idempotencyKey ? `${commandName}:${idempotencyKey}` : createOperationKey(commandName)).slice(0, 200),
    before,
    after,
  };
  document.documentElement.dataset.cloudCommit = 'pending';
  window.dispatchEvent(new CustomEvent<ShowroomCommandCommitted>(SHOWROOM_COMMAND_COMMITTED_EVENT, { detail }));
}
