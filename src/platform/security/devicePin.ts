import { getBrowserLocalStorage } from '@platform/storage';

const DEVICE_PIN_STORAGE_KEY = 'lena:device-security:pin:v1';
const PIN_PATTERN = /^\d{6}$/;
const PIN_HASH_ITERATIONS = 210_000;
const PIN_HASH_BYTES = 32;

type StoredDevicePin = {
  version: 1;
  iterations: number;
  salt: string;
  verifier: string;
};

function getCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('لا يدعم هذا الجهاز حماية رقم القفل. حدّث المتصفح أو التطبيق ثم حاولي مجدداً.');
  }
  return globalThis.crypto;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function parseStoredPin(value: string | null): StoredDevicePin | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== 'object'
      || parsed === null
      || Array.isArray(parsed)
      || (parsed as Record<string, unknown>).version !== 1
      || !Number.isInteger((parsed as Record<string, unknown>).iterations)
      || Number((parsed as Record<string, unknown>).iterations) < 100_000
      || typeof (parsed as Record<string, unknown>).salt !== 'string'
      || typeof (parsed as Record<string, unknown>).verifier !== 'string'
    ) {
      return null;
    }

    const stored = parsed as StoredDevicePin;
    if (!hexToBytes(stored.salt) || !hexToBytes(stored.verifier)) return null;
    return stored;
  } catch {
    return null;
  }
}

function assertValidPin(pin: string): void {
  if (!PIN_PATTERN.test(pin)) {
    throw new Error('أدخلي رقم قفل من 6 أرقام.');
  }
}

async function deriveVerifier(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const crypto = getCrypto();
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    PIN_HASH_BYTES * 8,
  );
  return bytesToHex(new Uint8Array(bits));
}

function constantTimeEquals(first: string, second: string): boolean {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Device protection is intentionally separate from the operational database:
 * a backup, import, or showroom-data reset must never copy or silently remove
 * the lock of the physical device it is opened on.
 */
export function hasDevicePin(): boolean {
  const storage = getBrowserLocalStorage();
  return Boolean(storage && parseStoredPin(storage.getItem(DEVICE_PIN_STORAGE_KEY)));
}

/** Stores only a salted PBKDF2 verifier; the PIN is never persisted. */
export async function configureDevicePin(pin: string): Promise<void> {
  assertValidPin(pin);
  const storage = getBrowserLocalStorage();
  if (!storage) throw new Error('تعذر الوصول إلى التخزين الآمن لهذا الجهاز.');

  const crypto = getCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const verifier = await deriveVerifier(pin, salt, PIN_HASH_ITERATIONS);
  const stored: StoredDevicePin = {
    version: 1,
    iterations: PIN_HASH_ITERATIONS,
    salt: bytesToHex(salt),
    verifier,
  };

  storage.setItem(DEVICE_PIN_STORAGE_KEY, JSON.stringify(stored));
}

export async function verifyDevicePin(pin: string): Promise<boolean> {
  if (!PIN_PATTERN.test(pin)) return false;
  const storage = getBrowserLocalStorage();
  const stored = storage ? parseStoredPin(storage.getItem(DEVICE_PIN_STORAGE_KEY)) : null;
  if (!stored) return false;

  const salt = hexToBytes(stored.salt);
  if (!salt) return false;
  const verifier = await deriveVerifier(pin, salt, stored.iterations);
  return constantTimeEquals(verifier, stored.verifier);
}

export async function changeDevicePin(currentPin: string, nextPin: string): Promise<void> {
  if (!(await verifyDevicePin(currentPin))) {
    throw new Error('رقم القفل الحالي غير صحيح.');
  }
  await configureDevicePin(nextPin);
}

export async function removeDevicePin(currentPin: string): Promise<void> {
  if (!(await verifyDevicePin(currentPin))) {
    throw new Error('رقم القفل الحالي غير صحيح.');
  }
  getBrowserLocalStorage()?.removeItem(DEVICE_PIN_STORAGE_KEY);
}
