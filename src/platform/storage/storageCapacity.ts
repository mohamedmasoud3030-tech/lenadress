export type StorageCapacityStatus = 'healthy' | 'warning' | 'critical' | 'unavailable';

export type StorageCapacityEstimate = {
  usageBytes: number;
  quotaBytes: number;
  usedPercent: number;
  status: StorageCapacityStatus;
};

const WARNING_PERCENT = 80;
const CRITICAL_PERCENT = 95;

export function classifyStorageCapacity(usageBytes: number, quotaBytes: number): StorageCapacityEstimate | null {
  if (!Number.isFinite(usageBytes) || !Number.isFinite(quotaBytes) || usageBytes < 0 || quotaBytes <= 0) {
    return null;
  }

  const usedPercent = Math.min(100, Math.max(0, Math.round((usageBytes / quotaBytes) * 100)));
  return {
    usageBytes,
    quotaBytes,
    usedPercent,
    status: usedPercent >= CRITICAL_PERCENT ? 'critical' : usedPercent >= WARNING_PERCENT ? 'warning' : 'healthy',
  };
}

/** Reads the browser-wide origin estimate; no operational data is written here. */
export async function getStorageCapacityEstimate(): Promise<StorageCapacityEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;

  try {
    const estimate = await navigator.storage.estimate();
    return classifyStorageCapacity(estimate.usage ?? -1, estimate.quota ?? -1);
  } catch {
    return null;
  }
}

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} كيلوبايت`;
  return `${(bytes / (1024 * 1024)).toLocaleString('ar-OM', { maximumFractionDigits: 1 })} ميجابايت`;
}
