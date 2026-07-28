import { useState } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn } from 'lucide-react';

type ImageGalleryProps = {
  images: string[];
  alt?: string;
};

export function ImageGallery({ images, alt = 'صورة العنصر' }: ImageGalleryProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showZoom, setShowZoom] = useState(false);

  if (!images || images.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-slate-200 bg-stone-50">
        <p className="text-slate-400">لا توجد صور متاحة</p>
      </div>
    );
  }

  const nextImage = () => {
    setCurrentIndex((prev) => (prev + 1) % images.length);
  };

  const prevImage = () => {
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  return (
    <>
      {/* Main Image */}
      <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white">
        <img
          src={images[currentIndex]}
          alt={`${alt} - ${currentIndex + 1}`}
          className="h-64 w-full cursor-pointer object-cover object-center md:h-96"
          onClick={() => setShowZoom(true)}
        />

        {/* Navigation Arrows */}
        {images.length > 1 && (
          <>
            <button
              type="button"
              aria-label="الصورة السابقة"
              onClick={prevImage}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 shadow-md transition hover:bg-white"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              type="button"
              aria-label="الصورة التالية"
              onClick={nextImage}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 shadow-md transition hover:bg-white"
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}

        {/* Zoom Icon */}
        <button
          type="button"
          aria-label="تكبير الصورة"
          onClick={() => setShowZoom(true)}
          className="absolute bottom-2 right-2 rounded-full bg-white/80 p-2 shadow-md transition hover:bg-white"
        >
          <ZoomIn size={18} />
        </button>
      </div>

      {/* Thumbnail Strip */}
      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
          {images.map((img, index) => (
            <button
              key={index}
              type="button"
              aria-label={`عرض الصورة رقم ${index + 1}`}
              onClick={() => setCurrentIndex(index)}
              className={`h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border-2 transition ${
                index === currentIndex ? 'border-amber-500' : 'border-slate-200'
              }`}
            >
              <img src={img} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Zoom Modal */}
      {showZoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setShowZoom(false)}
        >
          <button
            type="button"
            aria-label="إغلاق العرض المكبر"
            onClick={() => setShowZoom(false)}
            className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white transition hover:bg-white/40"
          >
            <X size={24} />
          </button>
          <img
            src={images[currentIndex]}
            alt={alt}
            className="max-h-[90vh] max-w-[90vw] object-contain"
          />
        </div>
      )}
    </>
  );
}
