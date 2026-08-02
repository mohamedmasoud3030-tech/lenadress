import { getSupabaseClient, isSupabaseConfigured } from '../../lib/supabaseClient';

const CATALOGUE_BUCKET = 'catalogue-images';
const MAX_CATALOGUE_IMAGE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const SAFE_STORAGE_SEGMENT = /^[A-Za-z0-9_-]+$/;

export type UploadResult = {
  path: string;
  publicUrl: string;
  bytes: number;
};

export type UploadOutcome = {
  sourceIndex: number;
  result: UploadResult | null;
};

function dataUrlToBlob(dataUrl: string): Blob {
  const match = SUPPORTED_IMAGE_DATA_URL.exec(dataUrl);
  if (!match) throw new Error('Unsupported image data URL.');

  const [, mime, base64] = match;
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}

function getImageExtension(mimeType: string): string {
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('png')) return 'png';
  return 'jpg';
}

function generateStoragePath(dressId: string, mimeType: string): string {
  if (!SAFE_STORAGE_SEGMENT.test(dressId)) throw new Error('Unsafe catalogue item identifier.');

  const ext = getImageExtension(mimeType);
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('Secure random identifiers are unavailable.');
  }
  const id = crypto.randomUUID();
  return `${dressId}/${id}.${ext}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Uploads a compressed dataUrl to Supabase Storage catalogue-images bucket.
 * Returns public URL and path. Best-effort: returns null if not configured,
 * unauthenticated, invalid, or larger than the bucket limit.
 */
export async function uploadCompressedImageToSupabase(
  dressId: string,
  dataUrl: string,
): Promise<UploadResult | null> {
  if (!isSupabaseConfigured()) return null;
  if (typeof window === 'undefined') return null;

  try {
    const client = getSupabaseClient();
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData.session) return null;

    const blob = dataUrlToBlob(dataUrl);
    if (blob.size > MAX_CATALOGUE_IMAGE_BYTES) {
      console.warn(`Catalogue image exceeds bucket limit: ${blob.size} bytes for dress ${dressId}`);
      return null;
    }

    const mimeType = blob.type || 'image/webp';
    const path = generateStoragePath(dressId, mimeType);

    const { error } = await client.storage.from(CATALOGUE_BUCKET).upload(path, blob, {
      contentType: mimeType,
      upsert: false,
    });

    if (error) {
      console.warn('Supabase storage upload failed', error.message);
      return null;
    }

    const { data: publicUrlData } = client.storage.from(CATALOGUE_BUCKET).getPublicUrl(path);
    return {
      path,
      publicUrl: publicUrlData.publicUrl,
      bytes: blob.size,
    };
  } catch (error: unknown) {
    console.warn('uploadCompressedImageToSupabase exception', getErrorMessage(error));
    return null;
  }
}

export async function uploadMultipleCompressedImages(
  dressId: string,
  dataUrls: string[],
): Promise<UploadOutcome[]> {
  const outcomes: UploadOutcome[] = [];
  for (const [sourceIndex, dataUrl] of dataUrls.entries()) {
    const result = await uploadCompressedImageToSupabase(dressId, dataUrl);
    outcomes.push({ sourceIndex, result });
  }
  return outcomes;
}

export function getSuccessfulUploadUrls(outcomes: UploadOutcome[]): string[] {
  const urls: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.result) urls.push(outcome.result.publicUrl);
  }
  return urls;
}

export async function deleteSupabaseImage(path: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const client = getSupabaseClient();
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData.session) return false;
    const { error } = await client.storage.from(CATALOGUE_BUCKET).remove([path]);
    if (error) {
      console.warn('Supabase storage delete failed', error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
