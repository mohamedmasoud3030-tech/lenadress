import { commandBoundary, runCommand } from '@engines/workflows';
import {
  addAccessory,
  retireAccessory,
  updateAccessory,
  type Accessory,
} from '../accessories';
import {
  attachAccessoryToReservation,
  detachAccessoryFromReservation,
  type AttachAccessoryInput,
} from '../accessories/reservationAccessory.service';
import type { AddAccessoryInput, ReservationAccessory, UpdateAccessoryInput } from '../accessories/accessory.types';

/**
 * Atomic accessory commands.
 *
 * Creating an accessory allocates a durable code and writes an audit entry;
 * attaching one to a reservation writes the link, flips the accessory state and
 * writes audit. Both are multi-write operations, so they run through the shared
 * command runner: a failure leaves nothing behind and a duplicate submit is
 * rejected instead of creating a second record.
 */

export function addAccessoryCommand(input: AddAccessoryInput & { idempotencyKey?: string }): Accessory {
  const { idempotencyKey, ...accessoryInput } = input;
  return runCommand(
    { name: 'accessory.create', idempotencyKey, summarize: (accessory) => accessory.code },
    () => {
      const accessory = addAccessory(accessoryInput);
      commandBoundary('accessory.create:after-write');
      return accessory;
    },
  );
}

export function updateAccessoryCommand(id: string, updates: UpdateAccessoryInput, idempotencyKey?: string): Accessory {
  return runCommand(
    { name: 'accessory.update', idempotencyKey, summarize: (accessory) => accessory.code },
    () => {
      const accessory = updateAccessory(id, updates);
      commandBoundary('accessory.update:after-write');
      return accessory;
    },
  );
}

export function retireAccessoryCommand(id: string, idempotencyKey?: string): Accessory {
  return runCommand(
    { name: 'accessory.retire', idempotencyKey, summarize: (accessory) => accessory.code },
    () => {
      const accessory = retireAccessory(id);
      commandBoundary('accessory.retire:after-write');
      return accessory;
    },
  );
}

export function attachAccessoryCommand(
  input: AttachAccessoryInput & { idempotencyKey?: string },
): ReservationAccessory {
  const { idempotencyKey, ...linkInput } = input;
  return runCommand(
    { name: 'accessory.attach', idempotencyKey, summarize: (link) => link.accessoryCodeSnapshot },
    () => {
      const link = attachAccessoryToReservation(linkInput);
      commandBoundary('accessory.attach:after-write');
      return link;
    },
  );
}

export function detachAccessoryCommand(reservationNumber: string, accessoryId: string, idempotencyKey?: string): void {
  runCommand({ name: 'accessory.detach', idempotencyKey }, () => {
    detachAccessoryFromReservation(reservationNumber, accessoryId);
    commandBoundary('accessory.detach:after-write');
  });
}
