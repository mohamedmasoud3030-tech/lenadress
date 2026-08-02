import { useCallback, useMemo, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { compressImageFiles } from '@platform/images';

/**
 * The accepted size is the size of the file the operator picks, not the size
 * that gets stored: every photo is downscaled and re-encoded before it reaches
 * a collection. A phone photograph is routinely 4-6MB, and storing it raw as a
 * base64 data URL was the real cause of the quota risk in this app.
 */
const MAX_IMAGE_SIZE_BYTES = 12 * 1024 * 1024;
const LOCAL_STORAGE_WARNING_BYTES = 2.5 * 1024 * 1024;

type ImageUploadProps = {
  images: string[];
  onChange: (images: string[]) => void;
  maxImages?: number;
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${bytes} B`;
}

function estimateStoredImageBytes(images: string[]): number {
  return images.reduce((total, image) => total + image.length, 0);
}

export function ImageUpload({ images, onChange, maxImages = 5 }: ImageUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSavedBytes, setLastSavedBytes] = useState<number | null>(null);
  const estimatedStoredBytes = useMemo(() => estimateStoredImageBytes(images), [images]);
  const shouldShowStorageWarning = estimatedStoredBytes >= LOCAL_STORAGE_WARNING_BYTES;

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;

    setUploadError(null);

    const remainingSlots = maxImages - images.length;
    if (remainingSlots <= 0) {
      setUploadError(`تم الوصول إلى الحد الأقصى لعدد الصور (${maxImages}).`);
      return;
    }

    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      setUploadError('يمكن رفع ملفات الصور فقط.');
      return;
    }

    const oversizedFile = imageFiles.find((file) => file.size > MAX_IMAGE_SIZE_BYTES);
    if (oversizedFile) {
      setUploadError(`الصورة ${oversizedFile.name} أكبر من الحد المسموح (${formatBytes(MAX_IMAGE_SIZE_BYTES)} لكل صورة).`);
      return;
    }

    const filesToProcess = imageFiles.slice(0, remainingSlots);

    try {
      setIsProcessing(true);
      const compressed = await compressImageFiles(filesToProcess);
      const savedBytes = compressed.reduce((total, result) => total + (result.originalBytes - result.compressedBytes), 0);
      setLastSavedBytes(savedBytes > 0 ? savedBytes : null);
      onChange([...images, ...compressed.map((result) => result.dataUrl)]);
    } catch (error) {
      console.error('Image upload error:', error);
      setUploadError('تعذر رفع الصور المختارة. حاولي مرة أخرى.');
    } finally {
      setIsProcessing(false);
    }
  }, [images, maxImages, onChange]);

  const handleDrag = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'dragenter' || event.type === 'dragover') {
      setDragActive(true);
    } else if (event.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    void handleFiles(event.dataTransfer.files);
  }, [handleFiles]);

  const removeImage = (index: number) => {
    const nextImages = [...images];
    nextImages.splice(index, 1);
    onChange(nextImages);

    if (uploadError) {
      setUploadError(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="block text-sm font-bold text-slate-700">
          صور العنصر (حتى {maxImages} صور)
        </label>
        <p className="text-xs text-slate-500">
          الحجم التقديري المخزن حالياً: {formatBytes(estimatedStoredBytes)}
        </p>
      </div>

      {uploadError && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
          {uploadError}
        </div>
      )}

      {isProcessing && (
        <p role="status" className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-bold text-sky-900">
          جارٍ ضغط الصور لتقليل مساحة التخزين…
        </p>
      )}

      {lastSavedBytes !== null && !isProcessing && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
          تم ضغط الصور وتوفير {formatBytes(lastSavedBytes)} من مساحة التخزين.
        </p>
      )}

      {shouldShowStorageWarning && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          الصور الحالية كبيرة نسبيًا. لتسريع الحفظ، قللي عدد الصور أو اختاري صورًا أصغر حجمًا.
        </div>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-3 md:grid-cols-5">
          {images.map((img, index) => (
            <div key={index} className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200">
              <img
                src={img}
                alt={`صورة ${index + 1}`}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(index)}
                className="absolute right-1 top-1 rounded-full bg-red-500 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {images.length < maxImages && (
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 transition-colors ${
            dragActive
              ? 'border-amber-500 bg-amber-50'
              : 'border-slate-300 hover:border-slate-400'
          }`}
        >
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              void handleFiles(event.target.files);
              event.currentTarget.value = '';
            }}
            className="hidden"
            id="image-upload"
          />
          <label htmlFor="image-upload" className="cursor-pointer text-center">
            <ImagePlus size={40} className="mx-auto mb-2 text-slate-400" />
            <p className="text-sm text-slate-600">
              اضغطي هنا أو اسحبي الصور لرفعها
            </p>
            <p className="mt-1 text-xs text-slate-400">
              (JPG, PNG - حتى {formatBytes(MAX_IMAGE_SIZE_BYTES)} لكل صورة، تُضغط تلقائياً قبل الحفظ)
            </p>
          </label>
        </div>
      )}
    </div>
  );
}
