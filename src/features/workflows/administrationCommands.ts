import { commandBoundary, runCommand, runCommandAsync } from '@engines/workflows';
import {
  importDatabaseBackupAsync,
  resetDatabase,
  type LocalDatabaseBackup,
} from '../../services/localDatabase';
import { migrateImagesToIndexedDB } from '../../services/imageMigration.service';
import { recordAudit } from '../audit/audit.service';
import {
  addConductNote,
  removeConductNote,
  type AddConductNoteInput,
} from '../customers/customerConduct.service';
import {
  addCustomer,
  archiveCustomer,
  deleteCustomer,
  updateCustomer,
  type AddCustomerInput,
  type UpdateCustomerInput,
} from '../customers/customer.service';
import type { Customer } from '../customers/customer.types';
import {
  addDress,
  archiveDress,
  deleteDress,
  type AddDressServiceInput,
} from '../dresses/dress.service';
import type { Dress } from '../dresses/dress.types';
import {
  saveAppPreferences,
  type AppPreferences,
} from '../preferences/preferences.service';
import {
  resetPrintSettings,
  savePrintSettings,
} from '../preferences/printSettings.service';
import {
  resetShowroomProfile,
  saveShowroomProfile,
  type LandingShowroomProfile,
} from '../preferences/showroomProfile.service';
import type { PrintSettings } from '@platform/printing';
import {
  cancelStocktakeSession,
  completeStocktakeSession,
  startStocktakeSession,
} from '../stocktake/stocktake.service';
import type { StocktakeReport, StocktakeSession } from '../stocktake/stocktake.types';
import { dismissReminder } from '../reminders/reminder.service';
import type { ReminderDismissal } from '../reminders/reminder.types';
import {
  resetMessageTemplates,
  saveMessageTemplates,
  type MessageTemplates,
} from '../reminders/messageTemplates';
import {
  addWaitlistEntry,
  closeWaitlistEntry,
  markWaitlistNotified,
} from '../waitlist/waitlist.service';
import type { AddWaitlistEntryInput, WaitlistEntry } from '../waitlist/waitlist.types';

function atomic<T>(
  name: string,
  boundary: string,
  idempotencyKey: string | undefined,
  execute: () => T,
  summarize?: (result: T) => string,
): T {
  return runCommand({ name, idempotencyKey, summarize }, () => {
    const result = execute();
    commandBoundary(boundary);
    return result;
  });
}

function atomicAsync<T>(
  name: string,
  boundary: string,
  idempotencyKey: string | undefined,
  execute: () => Promise<T>,
  summarize?: (result: T) => string,
): Promise<T> {
  return runCommandAsync({ name, idempotencyKey, summarize }, async () => {
    const result = await execute();
    commandBoundary(boundary);
    return result;
  });
}

export function addDressCommand(input: AddDressServiceInput & { idempotencyKey?: string }): Dress {
  const { idempotencyKey, ...payload } = input;
  return atomic('inventory.create', 'inventory.create:after-write', idempotencyKey, () => addDress(payload), (dress) => dress.code);
}

export function archiveDressCommand(code: string, idempotencyKey?: string): Dress {
  return atomic('inventory.archive', 'inventory.archive:after-write', idempotencyKey, () => {
    const dress = archiveDress(code);
    if (!dress) throw new Error('العنصر المحدد غير موجود.');
    return dress;
  }, (dress) => dress.code);
}

export function deleteDressCommand(code: string, idempotencyKey?: string): boolean {
  return atomic('inventory.delete', 'inventory.delete:after-write', idempotencyKey, () => deleteDress(code));
}

export function addCustomerCommand(input: AddCustomerInput & { idempotencyKey?: string }): Customer {
  const { idempotencyKey, ...payload } = input;
  return atomic('customer.create', 'customer.create:after-write', idempotencyKey, () => addCustomer(payload), (customer) => customer.id);
}

export function updateCustomerCommand(id: string, updates: UpdateCustomerInput, idempotencyKey?: string): Customer {
  return atomic('customer.update', 'customer.update:after-write', idempotencyKey, () => updateCustomer(id, updates), (customer) => customer.id);
}

export function archiveCustomerCommand(id: string, idempotencyKey?: string): Customer {
  return atomic('customer.archive', 'customer.archive:after-write', idempotencyKey, () => {
    const customer = archiveCustomer(id);
    if (!customer) throw new Error('العميلة المحددة غير موجودة.');
    return customer;
  }, (customer) => customer.id);
}

export function deleteCustomerCommand(id: string, idempotencyKey?: string): boolean {
  return atomic('customer.delete', 'customer.delete:after-write', idempotencyKey, () => deleteCustomer(id));
}

export function addConductNoteCommand(input: AddConductNoteInput, idempotencyKey?: string) {
  return atomic('customer.conduct.add', 'customer.conduct.add:after-write', idempotencyKey, () => addConductNote(input), (note) => note.id);
}

export function removeConductNoteCommand(noteId: string, idempotencyKey?: string): void {
  atomic('customer.conduct.remove', 'customer.conduct.remove:after-write', idempotencyKey, () => removeConductNote(noteId));
}

export function addWaitlistEntryCommand(input: AddWaitlistEntryInput & { idempotencyKey?: string }): WaitlistEntry {
  const { idempotencyKey, ...payload } = input;
  return atomic('waitlist.create', 'waitlist.create:after-write', idempotencyKey, () => addWaitlistEntry(payload), (entry) => entry.id);
}

export function markWaitlistNotifiedCommand(id: string, idempotencyKey?: string): WaitlistEntry {
  return atomic('waitlist.notify', 'waitlist.notify:after-write', idempotencyKey, () => markWaitlistNotified(id), (entry) => entry.id);
}

export function closeWaitlistEntryCommand(id: string, idempotencyKey?: string): WaitlistEntry {
  return atomic('waitlist.close', 'waitlist.close:after-write', idempotencyKey, () => closeWaitlistEntry(id), (entry) => entry.id);
}

export function startStocktakeSessionCommand(scope?: string, idempotencyKey?: string): StocktakeSession {
  return atomic('stocktake.start', 'stocktake.start:after-write', idempotencyKey, () => startStocktakeSession(scope), (session) => session.sessionNumber);
}

export function completeStocktakeSessionCommand(sessionId: string, notes?: string, idempotencyKey?: string): StocktakeReport {
  return atomic('stocktake.complete', 'stocktake.complete:after-write', idempotencyKey, () => completeStocktakeSession(sessionId, notes), (report) => report.session.sessionNumber);
}

export function cancelStocktakeSessionCommand(sessionId: string, idempotencyKey?: string): StocktakeSession {
  return atomic('stocktake.cancel', 'stocktake.cancel:after-write', idempotencyKey, () => cancelStocktakeSession(sessionId), (session) => session.sessionNumber);
}

export function saveAppPreferencesCommand(input: AppPreferences, idempotencyKey?: string): AppPreferences {
  return atomic('preferences.save', 'preferences.save:after-write', idempotencyKey, () => saveAppPreferences(input));
}

export function saveShowroomProfileCommand(profile: LandingShowroomProfile, idempotencyKey?: string): LandingShowroomProfile {
  return atomic('profile.save', 'profile.save:after-write', idempotencyKey, () => {
    const saved = saveShowroomProfile(profile);
    recordAudit({ action: 'update', entityType: 'preferences', entityId: 'showroom-profile', summary: 'تم تحديث هوية المعرض وبيانات التواصل.' });
    return saved;
  });
}

export function resetShowroomProfileCommand(idempotencyKey?: string): LandingShowroomProfile {
  return atomic('profile.reset', 'profile.reset:after-write', idempotencyKey, () => {
    const profile = resetShowroomProfile();
    recordAudit({ action: 'update', entityType: 'preferences', entityId: 'showroom-profile', summary: 'تمت إعادة هوية المعرض إلى القيم الافتراضية.' });
    return profile;
  });
}

export function savePrintSettingsCommand(settings: PrintSettings, idempotencyKey?: string): PrintSettings {
  return atomic('print-settings.save', 'print-settings.save:after-write', idempotencyKey, () => {
    const saved = savePrintSettings(settings);
    recordAudit({ action: 'update', entityType: 'preferences', entityId: 'print-settings', summary: 'تم تحديث إعدادات الطباعة.' });
    return saved;
  });
}

export function resetPrintSettingsCommand(idempotencyKey?: string): PrintSettings {
  return atomic('print-settings.reset', 'print-settings.reset:after-write', idempotencyKey, () => {
    const settings = resetPrintSettings();
    recordAudit({ action: 'update', entityType: 'preferences', entityId: 'print-settings', summary: 'تمت إعادة إعدادات الطباعة إلى القيم الافتراضية.' });
    return settings;
  });
}

export function saveMessageTemplatesCommand(input: Partial<MessageTemplates>, idempotencyKey?: string): MessageTemplates {
  return atomic('message-templates.save', 'message-templates.save:after-write', idempotencyKey, () => saveMessageTemplates(input));
}

export function resetMessageTemplatesCommand(idempotencyKey?: string): MessageTemplates {
  return atomic('message-templates.reset', 'message-templates.reset:after-write', idempotencyKey, () => resetMessageTemplates());
}

export function dismissReminderCommand(
  reminderRef: string,
  channel: ReminderDismissal['channel'] = 'manual',
  idempotencyKey?: string,
): ReminderDismissal {
  return atomic('reminder.dismiss', 'reminder.dismiss:after-write', idempotencyKey, () => dismissReminder(reminderRef, channel));
}

export function resetApplicationDataCommand(idempotencyKey?: string): void {
  atomic('database.reset', 'database.reset:after-write', idempotencyKey, () => {
    resetDatabase();
    recordAudit({
      action: 'reset-data',
      entityType: 'database',
      entityId: new Date().toISOString(),
      summary: 'تم تصفير بيانات التطبيق بعد تأكيد صريح.',
    });
  });
}

export function importDatabaseBackupCommand(
  value: unknown,
  idempotencyKey?: string,
): Promise<LocalDatabaseBackup> {
  return atomicAsync(
    'database.import',
    'database.import:after-write',
    idempotencyKey,
    async () => {
      const restored = await importDatabaseBackupAsync(value);
      recordAudit({
        action: 'import-backup',
        entityType: 'backup',
        entityId: restored.exportedAt,
        summary: 'تم استيراد نسخة احتياطية واستبدال بيانات التطبيق الحالية.',
      });
      return restored;
    },
    (backup) => backup.exportedAt,
  );
}

export type ImageMigrationResult = Awaited<ReturnType<typeof migrateImagesToIndexedDB>>;

export function migrateImagesCommand(idempotencyKey?: string): Promise<ImageMigrationResult> {
  return atomicAsync('storage.migrate-images', 'storage.migrate-images:after-write', idempotencyKey, async () => {
    const result = await migrateImagesToIndexedDB();
    if (!result.skipped) {
      recordAudit({
        action: 'migrate-images',
        entityType: 'storage',
        entityId: new Date().toISOString(),
        summary: `تم ترحيل ${result.migrated} صورة إلى IndexedDB.`,
      });
    }
    return result;
  });
}
