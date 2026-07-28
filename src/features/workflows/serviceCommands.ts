import { commandBoundary, runCommand } from '@engines/workflows';
import {
  cancelServiceTask,
  completeServiceTask,
  openServiceTask,
  startServiceTask,
  type CompleteServiceTaskInput,
  type OpenServiceTaskInput,
} from '../service/service.service';
import type { ServiceTask } from '../service/service.types';

/**
 * Service workflow commands.
 *
 * Completing a task can create an expense, change the item state and write
 * audit, so it must be atomic: a failure must not leave a cost posted against
 * an item that never left the queue.
 */

export function openServiceTaskCommand(input: OpenServiceTaskInput & { idempotencyKey?: string }): ServiceTask {
  const { idempotencyKey, ...taskInput } = input;
  return runCommand(
    { name: 'service.open', idempotencyKey, summarize: (task) => task.taskNumber },
    () => {
      const task = openServiceTask(taskInput);
      commandBoundary('service.open:after-write');
      return task;
    },
  );
}

export function startServiceTaskCommand(taskId: string, idempotencyKey?: string): ServiceTask {
  return runCommand({ name: 'service.start', idempotencyKey }, () => {
    const task = startServiceTask(taskId);
    commandBoundary('service.start:after-write');
    return task;
  });
}

export function completeServiceTaskCommand(input: CompleteServiceTaskInput & { idempotencyKey?: string }): ServiceTask {
  const { idempotencyKey, ...taskInput } = input;
  return runCommand(
    { name: 'service.complete', idempotencyKey, summarize: (task) => task.taskNumber },
    () => {
      const task = completeServiceTask(taskInput);
      commandBoundary('service.complete:after-write');
      return task;
    },
  );
}

export function cancelServiceTaskCommand(taskId: string, reason: string, idempotencyKey?: string): ServiceTask {
  return runCommand({ name: 'service.cancel', idempotencyKey }, () => {
    const task = cancelServiceTask(taskId, reason);
    commandBoundary('service.cancel:after-write');
    return task;
  });
}
