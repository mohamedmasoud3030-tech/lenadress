import { useCallback, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { compressImageFiles } from '@platform/images';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import type { ConditionPhoto } from './deliveryReturn.types';

/**
 * Condition evidence capture for a handover.
 *
 * `capture="environment"` asks a phone to open the rear camera directly instead
 * of the photo library, because the photograph is meant to be taken at the
 * counter with the customer present — a library picker invites attaching an old
 * image, which is exactly the ambiguity this feature removes.
 *
 * Every photo is compressed through the platform helper before it enters the
 * record. These images travel inside the record and therefore inside every
 * backup, so storing raw camera output here would turn the backup file into the
 * next storage problem.
 */

const MAX_PHOTOS = 4;

function generatePhotoId(): string {
  const runtimeCrypto = globalThis.crypto;
  if (runtimeCrypto && typeof runtimeCrypto.randomUUID === 'function') {
    try {
      return `cph-${runtimeCrypto.randomUUID()}`;
    } catch {
      // Fall through to the time-based identifier.
    }
  }
  return `cph-${Date.now().toString(36)}`;
}

export function ConditionPhotoCapture({
  label,
  hint,
  photos,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  photos: ConditionPhoto[];
  onChange: (photos: ConditionPhoto[]) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const inputId = `condition-photos-${label.replace(/\s+/g, '-')}`;

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);

    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      setError(`الحد الأقصى ${MAX_PHOTOS} صور لكل عملية.`);
      return;
    }

    const selected = Array.from(files).filter((file) => file.type.startsWith('image/')).slice(0, remaining);
    if (selected.length === 0) {
      setError('يمكن إرفاق صور فقط.');
      return;
    }

    try {
      setIsProcessing(true);
      const compressed = await compressImageFiles(selected);
      const capturedAt = new Date().toISOString();
      onChange([
        ...photos,
        ...compressed.map((result) => ({ id: generatePhotoId(), dataUrl: result.dataUrl, capturedAt })),
      ]);
    } catch {
      setError('تعذر إرفاق الصور. حاولي مرة أخرى.');
    } finally {
      setIsProcessing(false);
    }
  }, [photos, onChange]);

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="block text-sm font-bold text-slate-700">{label}</span>
        <span className="text-xs text-slate-500">{photos.length} / {MAX_PHOTOS}</span>
      </div>
      {hint && <p className="text-xs leading-5 text-slate-500">{hint}</p>}

      {error && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800">
          {error}
        </p>
      )}

      {isProcessing && (
        <p role="status" className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-900">
          جارٍ ضغط الصور…
        </p>
      )}

      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((photo, index) => (
            <li key={photo.id} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200">
              <img src={photo.dataUrl} alt={`${label} ${index + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onChange(photos.filter((item) => item.id !== photo.id))}
                aria-label={`حذف ${label} ${index + 1}`}
                disabled={disabled}
                className={`absolute left-1 top-1 rounded-full bg-rose-600 p-1 text-white transition hover:bg-rose-700 ${AMBER_FOCUS_RING_CLASS_NAME}`}
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {photos.length < MAX_PHOTOS && (
        <>
          <input
            id={inputId}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            disabled={disabled || isProcessing}
            onChange={(event) => {
              void handleFiles(event.target.files);
              event.currentTarget.value = '';
            }}
            className="sr-only"
          />
          <label
            htmlFor={inputId}
            className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            <Camera aria-hidden="true" className="h-4 w-4" />
            تصوير حالة القطعة
          </label>
        </>
      )}
    </div>
  );
}
