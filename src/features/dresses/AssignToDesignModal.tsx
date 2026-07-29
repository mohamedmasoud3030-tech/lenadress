import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/shared/Modal';
import { FormActions } from '../../components/shared/FormField';
import { SearchableSelect, type SearchableOption } from '../../components/shared/SearchableSelect';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { createSubmissionKey } from '../../shared/utils/submissionKey';
import { assignPieceToDesignCommand } from '../workflows';
import { getDresses } from './dress.service';
import { getDressDesigns } from './design.service';

type Props = {
  open: boolean;
  /** Pre-selected design when opened from a design page. */
  designId?: string;
  /** Pre-selected piece when opened from an item page. */
  dressCode?: string;
  onClose: () => void;
  onAssigned: (dressCode: string) => void;
};

/**
 * Links an already-existing piece to a design.
 *
 * Without this the design feature only helps stock added after it shipped: a
 * showroom that already owns two hundred ungrouped pieces could never group
 * them, which would make the whole feature useless on real data.
 *
 * The operation changes only the parent link — never the stock code, the
 * barcode, the price or the booking history.
 */
export function AssignToDesignModal({ open, designId, dressCode, onClose, onAssigned }: Props) {
  const [selectedDesign, setSelectedDesign] = useState(designId ?? '');
  const [selectedPiece, setSelectedPiece] = useState(dressCode ?? '');
  const [error, setError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionKey, setSubmissionKey] = useState(() => createSubmissionKey('assign'));

  const designs = useMemo(() => (open ? getDressDesigns().filter((design) => !design.archivedAt) : []), [open]);
  const pieces = useMemo(() => (open ? getDresses() : []), [open]);

  useEffect(() => {
    if (!open) return;
    setSelectedDesign(designId ?? '');
    setSelectedPiece(dressCode ?? '');
    setError(null);
    setIsSubmitting(false);
    setSubmissionKey(createSubmissionKey('assign'));
  }, [open, designId, dressCode]);

  const designOptions = useMemo<SearchableOption[]>(() => designs.map((design) => ({
    value: design.id,
    label: design.name,
    hint: `${design.code} · ${design.category}`,
  })), [designs]);

  const pieceOptions = useMemo<SearchableOption[]>(() => pieces.map((piece) => ({
    value: piece.code,
    label: `${piece.code} — ${piece.name}`,
    hint: `${piece.size} · ${piece.color}${piece.designCode ? ` · مرتبط بـ ${piece.designCode}` : ' · غير مرتبط'}`,
  })), [pieces]);

  const close = () => {
    setError(null);
    onClose();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || !selectedDesign || !selectedPiece) return;
    setError(null);
    setIsSubmitting(true);

    try {
      assignPieceToDesignCommand(selectedPiece, selectedDesign, submissionKey);
      onAssigned(selectedPiece);
      close();
    } catch (reason: unknown) {
      setIsSubmitting(false);
      setError(reason);
    }
  };

  return (
    <Modal open={open} onClose={close} title="ربط قطعة قائمة بتصميم" className="max-w-xl">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر ربط القطعة بالتصميم." />}

        <p className="rounded-xl bg-stone-50 p-3 text-xs leading-5 text-slate-600">
          الربط يغيّر انتماء القطعة فقط. كود المخزون والباركود والسعر وكامل تاريخ الحجوزات تبقى كما هي.
        </p>

        <SearchableSelect
          label="القطعة"
          required
          value={selectedPiece}
          onChange={setSelectedPiece}
          options={pieceOptions}
          placeholder="اختاري القطعة"
          searchPlaceholder="ابحثي بالكود أو الاسم…"
          unavailableText="لا توجد قطع في المخزون."
        />

        <SearchableSelect
          label="التصميم"
          required
          value={selectedDesign}
          onChange={setSelectedDesign}
          options={designOptions}
          placeholder="اختاري التصميم"
          searchPlaceholder="ابحثي باسم التصميم أو كوده…"
          unavailableText="لا توجد تصاميم مسجلة بعد."
        />

        <FormActions
          onCancel={close}
          submitLabel="ربط بالتصميم"
          isSubmitting={isSubmitting}
          disabled={!selectedDesign || !selectedPiece}
        />
      </form>
    </Modal>
  );
}
