import {
  exportDatabaseBackup,
  exportDatabaseBackupAsync,
  writeCollection,
  removeStoredCollection,
  listStoredCollectionNames,
  type LocalDatabaseBackup,
  type DatabaseMetadata,
} from './persistenceEngine';
import { METADATA_KEY, STORAGE_PREFIX } from './collectionRegistry';

const MIGRATION_MARKERS_KEY = `${STORAGE_PREFIX}:migration-markers`;
import { getBrowserLocalStorage, type StoragePort } from '@platform/storage';
import { restoreImages } from '@platform/images';

export type PersistenceSnapshot = LocalDatabaseBackup;

function getStorage(): StoragePort | null {
  return getBrowserLocalStorage();
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function restoreMigrationMarkers(snapshot: PersistenceSnapshot): void {
  if (!snapshot.migrationMarkers) return;
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(MIGRATION_MARKERS_KEY, JSON.stringify(snapshot.migrationMarkers));
  } catch {
    // Best-effort marker restore during rollback.
  }
}

function restoreMetadataDirectly(metadata: DatabaseMetadata): void {
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(METADATA_KEY, JSON.stringify(metadata));
    } catch {
      // Best-effort metadata restore during rollback.
    }
  }
}

export function createDatabaseSnapshot(): PersistenceSnapshot {
  return exportDatabaseBackup();
}

export async function createDatabaseSnapshotAsync(): Promise<PersistenceSnapshot> {
  return await exportDatabaseBackupAsync();
}

/**
 * Restores a snapshot without a destructive pre-clear.
 *
 * A previous implementation cleared every application key before rewriting the
 * snapshot. When the underlying storage was the reason the transaction failed
 * (quota exceeded, corrupted write), the rewrite failed too and the showroom was
 * left with no data at all. Restoring now overwrites the snapshot values first
 * and only removes collections that the snapshot does not contain, so a failing
 * storage leaves the previous state in place instead of destroying it.
 */
function restoreSnapshotCollections(snapshot: PersistenceSnapshot): void {
  restoreMetadataDirectly(snapshot.metadata);
  restoreMigrationMarkers(snapshot);

  const snapshotCollections = Object.keys(snapshot.collections);
  const snapshotCollectionSet = new Set(snapshotCollections);
  let writeFailure: unknown = null;

  snapshotCollections.forEach((collection) => {
    try {
      writeCollection(collection, snapshot.collections[collection]);
    } catch (error) {
      writeFailure = writeFailure ?? error;
    }
  });

  if (writeFailure) {
    // Do not prune anything when the storage is already refusing writes.
    return;
  }

  listStoredCollectionNames()
    .filter((collection) => !snapshotCollectionSet.has(collection))
    .forEach((collection) => removeStoredCollection(collection));
}

export function restoreDatabaseSnapshot(snapshot: PersistenceSnapshot): void {
  restoreSnapshotCollections(cloneValue(snapshot));
}

export async function restoreDatabaseSnapshotAsync(snapshot: PersistenceSnapshot): Promise<void> {
  const clonedSnapshot = cloneValue(snapshot);
  restoreSnapshotCollections(clonedSnapshot);
  if (clonedSnapshot.imageBlobs && Array.isArray(clonedSnapshot.imageBlobs)) {
    try {
      await restoreImages(clonedSnapshot.imageBlobs);
    } catch {
      // Best effort image restore on rollback
    }
  }
}

export function runInTransaction<T>(operation: () => T): T {
  const snapshot = createDatabaseSnapshot();
  try {
    return operation();
  } catch (error) {
    try {
      restoreDatabaseSnapshot(snapshot);
    } catch {
      // If restore itself fails, the original write failure is re-thrown as primary cause.
    }
    throw error;
  }
}

export async function runInTransactionAsync<T>(operation: () => Promise<T>): Promise<T> {
  const snapshot = await createDatabaseSnapshotAsync();
  try {
    return await operation();
  } catch (error) {
    try {
      await restoreDatabaseSnapshotAsync(snapshot);
    } catch {
      // If restore itself fails, the original write failure is re-thrown as primary cause.
    }
    throw error;
  }
}

export function runCompensatedOperation<T>(
  execute: () => T,
  compensate: (error: unknown, snapshot: PersistenceSnapshot) => void,
): T {
  const snapshot = createDatabaseSnapshot();
  try {
    return execute();
  } catch (error) {
    try {
      compensate(error, snapshot);
    } catch {
      restoreDatabaseSnapshot(snapshot);
    }
    throw error;
  }
}

export async function runCompensatedOperationAsync<T>(
  execute: () => Promise<T>,
  compensate: (error: unknown, snapshot: PersistenceSnapshot) => Promise<void> | void,
): Promise<T> {
  const snapshot = await createDatabaseSnapshotAsync();
  try {
    return await execute();
  } catch (error) {
    try {
      await compensate(error, snapshot);
    } catch {
      await restoreDatabaseSnapshotAsync(snapshot);
    }
    throw error;
  }
}
