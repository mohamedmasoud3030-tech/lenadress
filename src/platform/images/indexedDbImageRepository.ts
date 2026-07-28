/**
 * Image ids must be collision-safe like every other persisted id, so they come
 * from the platform crypto source rather than `Math.random()`. The platform
 * layer owns this because it is the only layer allowed to touch browser APIs.
 */
function generateImageId(): string {
  const runtimeCrypto = globalThis.crypto;
  if (runtimeCrypto && typeof runtimeCrypto.randomUUID === 'function') {
    try {
      return `img-${runtimeCrypto.randomUUID()}`;
    } catch {
      // Fall through to the counter-based identifier below.
    }
  }

  imageIdCounter = (imageIdCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `img-${Date.now().toString(36)}-${imageIdCounter.toString(36)}`;
}

let imageIdCounter = 0;

const DB_NAME = 'dress-roomshow-images';
const DB_VERSION = 1;
const STORE_NAME = 'images';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('تعذر فتح قاعدة بيانات الصور.'));
  });
}

export type StoredImage = {
  id: string;
  dressId: string;
  dataUrl: string;
  createdAt: string;
};

export async function saveImage(dressId: string, dataUrl: string): Promise<string> {
  const db = await openDB();
  const id = generateImageId();
  const record: StoredImage = { id, dressId, dataUrl, createdAt: new Date().toISOString() };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.add(record);
    request.onsuccess = () => resolve(id);
    request.onerror = () => reject(request.error ?? new Error('تعذر حفظ الصورة.'));
    tx.oncomplete = () => db.close();
  });
}

export async function saveImages(dressId: string, dataUrls: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const dataUrl of dataUrls) {
    const id = await saveImage(dressId, dataUrl);
    ids.push(id);
  }
  return ids;
}

export async function getImage(id: string): Promise<StoredImage | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result as StoredImage | undefined);
    request.onerror = () => reject(request.error ?? new Error('تعذر قراءة الصورة.'));
    tx.oncomplete = () => db.close();
  });
}

export async function getImagesByDressId(dressId: string): Promise<StoredImage[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const all = request.result as StoredImage[];
      resolve(all.filter((img) => img.dressId === dressId));
    };
    request.onerror = () => reject(request.error ?? new Error('تعذر قراءة الصور.'));
    tx.oncomplete = () => db.close();
  });
}

export async function deleteImage(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('تعذر حذف الصورة.'));
    tx.oncomplete = () => db.close();
  });
}

export async function deleteImagesByDressId(dressId: string): Promise<void> {
  const images = await getImagesByDressId(dressId);
  for (const img of images) {
    await deleteImage(img.id);
  }
}

export async function getAllImageDataUrls(dressId: string): Promise<string[]> {
  const images = await getImagesByDressId(dressId);
  return images.map((img) => img.dataUrl);
}

export async function getAllImages(): Promise<StoredImage[]> {
  if (!isIndexedDBAvailable()) return [];
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as StoredImage[]);
    request.onerror = () => reject(request.error ?? new Error('تعذر قراءة جميع الصور.'));
    tx.oncomplete = () => db.close();
  });
}

export async function clearAllImages(): Promise<void> {
  if (!isIndexedDBAvailable()) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('تعذر مسح الصور.'));
    tx.oncomplete = () => db.close();
  });
}

export async function restoreImages(images: StoredImage[]): Promise<void> {
  if (!isIndexedDBAvailable()) return;
  await clearAllImages();
  if (images.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const img of images) {
      store.put(img);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('تعذر استعادة الصور.'));
    };
  });
}

export async function getImageCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('تعذر عد الصور.'));
    tx.oncomplete = () => db.close();
  });
}

export function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}
