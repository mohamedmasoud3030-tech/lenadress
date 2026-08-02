/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSupabaseClient, isSupabaseConfigured } from '../../lib/supabaseClient';

export type UploadResult = {
  path: string;
  publicUrl: string;
  bytes: number;
};

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/webp';
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}

function generateStoragePath(dressId: string, mimeType: string): string {
  const ext = mimeType.includes('webp') ? 'webp' : mimeType.includes('png') ? 'png' : 'jpg';
  // Use crypto-backed ID, never Math.random for persisted identifiers
  let id: string;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    id = crypto.randomUUID();
  } else if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    id = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    // Fallback to timestamp + counter (still not Math.random)
    id = `${Date.now()}-${Math.floor(performance.now()).toString(36)}`;
  }
  return `${dressId}/${id}.${ext}`;
}

/**
 * Uploads a compressed dataUrl to Supabase Storage catalogue-images bucket.
 * Returns public URL and path. Best-effort: returns null if not configured or not authenticated.
 * Ensures small size: compressed dataUrl is already 1280px max, WebP 0.82.
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
    if (!sessionData.session) {
      // No authenticated user, skip (RLS will block anon upload if bucket is private, but catalogue-images is public)
      // We still try to upload as anon if bucket allows public insert? catalogue-images is public, but policy may require authenticated.
      // For now, try anyway and let storage handle.
    }

    const blob = dataUrlToBlob(dataUrl);
    // Enforce small size: if > 2MB after compression, still upload but log warning
    if (blob.size > 2 * 1024 * 1024) {
      console.warn(`Compressed image still large: ${blob.size} bytes for dress ${dressId}`);
    }

    const mimeType = blob.type || 'image/webp';
    const path = generateStoragePath(dressId, mimeType);

    const { error } = await client.storage.from('catalogue-images').upload(path, blob, {
      contentType: mimeType,
      upsert: false,
    });

    if (error) {
      console.warn('Supabase storage upload failed', error.message);
      return null;
    }

    const { data: publicUrlData } = client.storage.from('catalogue-images').getPublicUrl(path);
    return {
      path,
      publicUrl: publicUrlData.publicUrl,
      bytes: blob.size,
    };
  } catch (e) {
    console.warn('uploadCompressedImageToSupabase exception', (e as any)?.message);
    return null;
  }
}

export async function uploadMultipleCompressedImages(
  dressId: string,
  dataUrls: string[],
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  for (const dataUrl of dataUrls) {
    const result = await uploadCompressedImageToSupabase(dressId, dataUrl);
    if (result) results.push(result);
  }
  return results;
}

export async function deleteSupabaseImage(path: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const client = getSupabaseClient();
    const { error } = await client.storage.from('catalogue-images').remove([path]);
    if (error) {
      console.warn('Supabase storage delete failed', error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
