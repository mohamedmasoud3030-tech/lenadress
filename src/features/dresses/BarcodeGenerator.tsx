import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { printBarcodeLabel } from './printBarcodeLabel';

type BarcodeGeneratorProps = {
  value: string;
  onClick?: () => void;
  itemName?: string;
  itemCode?: string;
};

export function BarcodeGenerator({ value, onClick, itemName, itemCode }: BarcodeGeneratorProps) {
  const barcodeRef = useRef<SVGSVGElement>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);

  useEffect(() => {
    if (!barcodeRef.current || !value) {
      setGenerationError('لا يمكن توليد الباركود بدون قيمة صالحة.');
      return;
    }

    try {
      JsBarcode(barcodeRef.current, value, {
        format: 'CODE128',
        width: 2,
        height: 100,
        displayValue: true,
        fontSize: 16,
        background: '#ffffff',
        lineColor: '#000000',
        margin: 12,
      });
      setGenerationError(null);
    } catch (error) {
      console.error('Error generating barcode:', error);
      setGenerationError('تعذر توليد الباركود لهذه القيمة.');
    }
  }, [value]);

  const handlePrint = () => {
    if (!barcodeRef.current) return;

    try {
      printBarcodeLabel({
        value,
        itemName,
        itemCode,
        svgMarkup: new XMLSerializer().serializeToString(barcodeRef.current),
      });
      setPrintError(null);
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : 'تعذر تجهيز ملصق الباركود للطباعة.');
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-bold text-slate-700">الباركود</p>

      {generationError ? (
        <div role="alert" className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm font-medium text-red-700">
          {generationError}
        </div>
      ) : (
        <svg ref={barcodeRef} className="w-full max-w-xs" role="img" aria-label={`باركود العنصر ${itemCode || value}`}></svg>
      )}

      {printError ? (
        <p role="alert" className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm font-medium text-red-700">
          {printError}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={handlePrint}
          disabled={generationError !== null}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          طباعة الباركود
        </button>

        {onClick && (
          <button
            type="button"
            onClick={onClick}
            className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800"
          >
            توليد باركود جديد
          </button>
        )}
      </div>
    </div>
  );
}
