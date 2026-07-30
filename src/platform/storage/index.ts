export { BrowserLocalStorageAdapter, getBrowserLocalStorage } from './BrowserLocalStorageAdapter';
export type { StoragePort } from './StoragePort';
export {
  classifyStorageCapacity,
  formatStorageBytes,
  getStorageCapacityEstimate,
} from './storageCapacity';
export type { StorageCapacityEstimate, StorageCapacityStatus } from './storageCapacity';
export {
  StoragePersistenceError,
  createStoragePersistenceError,
} from './storagePersistenceError';
export type { StoragePersistenceErrorOptions } from './storagePersistenceError';
export * from './persistenceErrorMessage';
