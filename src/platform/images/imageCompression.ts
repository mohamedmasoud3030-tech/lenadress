/**
 * Client-side image downscaling and re-encoding.
 *
 * Photographs were stored exactly as the phone produced them: a raw data URL of
 * a 12-megapixel JPEG, up to 5MB each, five per item. Base64 adds a further
 * third on top. That is the actual cause of the storage risk in this app — not
 * the absence of a quota indicator. A hundred items with three photos each was
 * enough to exhaust the browser's quota, and the first symptom would be a save
 * failing in front of a customer.
 *
 * Downscaling to a long edge of 1280px and re-encoding as WebP typically cuts a
 * showroom photo by an order of magnitude while staying far above what is
 * needed to recognise a garment, print a contract thumbnail, or prove the
 * condition a dress went out in.
 *
 * This lives in `src/platform/` because it is the only layer permitted to touch
 * browser APIs (`Image`, `document.createElement('canvas')`, `FileReader`).
 *
 * Rejected alternatives:
 *   - A compression library (browser-image-compression, pica): tens of
 *     kilobytes added to a bundle that must be precached for offline use, to
 *     wrap a canvas call the platform already provides.
 *   - `createImageBitmap` + `OffscreenCanvas` in a worker: measurably better
 *     for bulk imports, but Safari's support for `OffscreenCanvas.convertToBlob`
 *     was the last to arrive and this app's primary target is an iPhone PWA.
 *     The main-thread path is universally supported; compression of a handful
 *     of photos is not worth a capability fork.
 *   - Storing the original alongside the compressed copy: doubles the very cost
 *     this exists to remove. The showroom never needs print-resolution masters.
 */

export type CompressionOptions = {
  /** Longest edge in CSS pixels after downscaling. */
  maxDimension?: number;
  /** Encoder quality, 0..1. */
  quality?: number;
  /** Preferred output type; falls back to JPEG when unsupported. */
  mimeType?: 'image/webp' | 'image/jpeg';
};

export type CompressionResult = {
  dataUrl: string;
  originalBytes: number;
  compressedBytes: number;
  width: number;
  height: number;
  /** The encoder actually used, which may differ from the request. */
  mimeType: string;
};

export const DEFAULT_MAX_DIMENSION = 1280;
export const DEFAULT_QUALITY = 0.82;

/** Approximate decoded byte length of a data URL, without allocating a copy. */
export function estimateDataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) return dataUrl.length;
  const payload = dataUrl.length - commaIndex - 1;
  const padding = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
  return Math.max(Math.floor((payload * 3) / 4) - padding, 0);
}

/** Target dimensions preserving the aspect ratio; never upscales. */
export function scaleToFit(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxDimension || longest === 0) return { width, height };
  const ratio = maxDimension / longest;
  return {
    width: Math.max(Math.round(width * ratio), 1),
    height: Math.max(Math.round(height * ratio), 1),
  };
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('تعذر قراءة الصورة.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('تعذر قراءة الصورة.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('تعذر فتح الصورة المختارة.'));
    image.src = dataUrl;
  });
}

/** True when the runtime can actually encode to the requested type. */
function canEncode(canvas: HTMLCanvasElement, mimeType: string): boolean {
  try {
    return canvas.toDataURL(mimeType).startsWith(`data:${mimeType}`);
  } catch {
    return false;
  }
}

/**
 * Downscales and re-encodes an image file.
 *
 * Never throws for a merely unhelpful result: if compression produces something
 * larger than the original (already-optimised small images sometimes do), the
 * original is returned. Silently storing a bigger file to satisfy a code path
 * would be the opposite of the point.
 */
export async function compressImageFile(
  file: Blob,
  options: CompressionOptions = {},
): Promise<CompressionResult> {
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const quality = options.quality ?? DEFAULT_QUALITY;
  const preferredType = options.mimeType ?? 'image/webp';

  const originalDataUrl = await readFileAsDataUrl(file);
  const originalBytes = file.size || estimateDataUrlBytes(originalDataUrl);

  // A runtime without canvas (tests, a hardened WebView) must still accept the
  // upload rather than reject the operator's photo.
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return {
      dataUrl: originalDataUrl,
      originalBytes,
      compressedBytes: originalBytes,
      width: 0,
      height: 0,
      mimeType: file.type || 'image/*',
    };
  }

  const image = await loadImage(originalDataUrl);
  const { width, height } = scaleToFit(image.naturalWidth || image.width, image.naturalHeight || image.height, maxDimension);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    return {
      dataUrl: originalDataUrl,
      originalBytes,
      compressedBytes: originalBytes,
      width,
      height,
      mimeType: file.type || 'image/*',
    };
  }

  // Photographs of fabric benefit visibly from smooth downsampling; the default
  // nearest-neighbour path leaves lace and beading looking aliased.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);

  const mimeType = canEncode(canvas, preferredType) ? preferredType : 'image/jpeg';
  const dataUrl = canvas.toDataURL(mimeType, quality);
  const compressedBytes = estimateDataUrlBytes(dataUrl);

  if (compressedBytes >= originalBytes) {
    return {
      dataUrl: originalDataUrl,
      originalBytes,
      compressedBytes: originalBytes,
      width: image.naturalWidth || width,
      height: image.naturalHeight || height,
      mimeType: file.type || 'image/*',
    };
  }

  return { dataUrl, originalBytes, compressedBytes, width, height, mimeType };
}

/** Compresses several files, keeping the caller's order. */
export async function compressImageFiles(
  files: Blob[],
  options: CompressionOptions = {},
): Promise<CompressionResult[]> {
  const results: CompressionResult[] = [];
  // Sequential on purpose: decoding several multi-megapixel images at once is
  // what makes a mid-range phone drop the tab.
  for (const file of files) {
    results.push(await compressImageFile(file, options));
  }
  return results;
}
