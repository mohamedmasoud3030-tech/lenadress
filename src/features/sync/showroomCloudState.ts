import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../lib/supabaseClient';
import {
  CURRENT_BACKUP_SCHEMA_VERSION,
  CURRENT_STORAGE_SCHEMA_VERSION,
  DATABASE_APPLICATION_ID,
  type LocalDatabaseBackup,
} from '@engines/persistence';

type ShowroomStateRow = {
  snapshot: unknown;
  revision: number;
  updated_at: string;
};

export type RemoteShowroomState = {
  snapshot: LocalDatabaseBackup;
  revision: number;
  updatedAt: string;
};

export class ShowroomCloudError extends Error {
  readonly code: string;

  constructor(message: string, code = 'LENA_CLOUD_ERROR', cause?: unknown) {
    super(message, { cause });
    this.name = 'ShowroomCloudError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSnapshot(value: unknown): LocalDatabaseBackup {
  if (!isRecord(value) || value.applicationId !== DATABASE_APPLICATION_ID || !isRecord(value.collections)) {
    throw new ShowroomCloudError('بيانات الخادم غير صالحة. تم إيقاف التشغيل لحماية السجلات.', 'LENA_INVALID_REMOTE_STATE');
  }

  const collections = Object.fromEntries(
    Object.entries(value.collections).map(([name, items]) => {
      if (!Array.isArray(items)) {
        throw new ShowroomCloudError(`قسم البيانات ${name} غير صالح.`, 'LENA_INVALID_REMOTE_STATE');
      }
      return [name, items];
    }),
  );
  const now = new Date().toISOString();
  return {
    applicationId: DATABASE_APPLICATION_ID,
    schemaVersion: CURRENT_STORAGE_SCHEMA_VERSION,
    backupVersion: CURRENT_BACKUP_SCHEMA_VERSION,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : now,
    metadata: {
      applicationId: DATABASE_APPLICATION_ID,
      schemaVersion: CURRENT_STORAGE_SCHEMA_VERSION,
      updatedAt: now,
    },
    collections,
    imageBlobs: [],
    migrationMarkers: isRecord(value.migrationMarkers) ? value.migrationMarkers : {},
  };
}

export function prepareSnapshotForCloud(snapshot: LocalDatabaseBackup): LocalDatabaseBackup {
  const clone = structuredClone(snapshot);
  clone.schemaVersion = CURRENT_STORAGE_SCHEMA_VERSION;
  clone.backupVersion = CURRENT_BACKUP_SCHEMA_VERSION;
  clone.imageBlobs = [];
  clone.exportedAt = new Date().toISOString();
  clone.metadata = {
    applicationId: DATABASE_APPLICATION_ID,
    schemaVersion: CURRENT_STORAGE_SCHEMA_VERSION,
    updatedAt: clone.exportedAt,
  };
  return clone;
}

export async function fetchShowroomState(): Promise<RemoteShowroomState> {
  const { data, error } = await getSupabaseClient()
    .from('showroom_state')
    .select('snapshot, revision, updated_at')
    .eq('id', 'main')
    .single();
  if (error) throw new ShowroomCloudError('تعذر تحميل قاعدة بيانات المعرض من الخادم.', error.code, error);
  const row = data as ShowroomStateRow;
  return { snapshot: normalizeSnapshot(row.snapshot), revision: Number(row.revision), updatedAt: row.updated_at };
}

export async function commitShowroomState(input: {
  expectedRevision: number;
  snapshot: LocalDatabaseBackup;
  idempotencyKey: string;
  commandName: string;
}): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc('apply_showroom_snapshot', {
    p_expected_revision: input.expectedRevision,
    p_snapshot: prepareSnapshotForCloud(input.snapshot),
    p_idempotency_key: input.idempotencyKey,
    p_command_name: input.commandName,
  });
  if (error) {
    const code = error.message.includes('LENA_REVISION_CONFLICT') ? 'LENA_REVISION_CONFLICT' : error.code;
    throw new ShowroomCloudError(
      code === 'LENA_REVISION_CONFLICT'
        ? 'تغيّرت البيانات من جهاز آخر. أُعيد تحميل أحدث نسخة لحمايتها من الكتابة فوقها.'
        : 'فشل حفظ العملية في الخادم. لم يتم اعتماد التغيير محليًا.',
      code,
      error,
    );
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!isRecord(result) || typeof result.revision !== 'number') {
    throw new ShowroomCloudError('لم يؤكد الخادم حفظ العملية.', 'LENA_INVALID_COMMIT_RESPONSE');
  }
  return result.revision;
}

export function subscribeToShowroomChanges(onChange: () => void): RealtimeChannel {
  return getSupabaseClient()
    .channel('showroom-state-main')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'showroom_state', filter: 'id=eq.main' }, onChange)
    .subscribe();
}

export async function unsubscribeFromShowroomChanges(channel: RealtimeChannel): Promise<void> {
  await getSupabaseClient().removeChannel(channel);
}

