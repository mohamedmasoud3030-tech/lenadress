import { commandBoundary, runCommand } from '@engines/workflows';
import { addDesignVariants, addDressDesign, archiveDressDesign, assignPieceToDesign } from '../dresses/design.service';
import type { AddDressDesignInput, DesignVariantInput, DressDesign } from '../dresses/design.types';
import type { Dress } from '../dresses/dress.types';

/**
 * Design commands.
 *
 * Creating a design plus its pieces writes the design, allocates a stock code
 * and a barcode for every piece, and writes audit entries — a multi-write
 * operation that must be all-or-nothing. A half-created design would leave
 * orphan pieces holding permanently-retired codes.
 */

export type AddDesignWithVariantsInput = {
  design: AddDressDesignInput;
  variants: DesignVariantInput[];
  idempotencyKey?: string;
};

export function addDesignWithVariantsCommand(
  input: AddDesignWithVariantsInput,
): { design: DressDesign; pieces: Dress[] } {
  const { idempotencyKey, design: designInput, variants } = input;

  return runCommand(
    { name: 'design.create', idempotencyKey, summarize: (result) => result.design.code },
    () => {
      const design = addDressDesign(designInput);
      const pieces = addDesignVariants(design.id, variants);
      commandBoundary('design.create:after-write');
      return { design, pieces };
    },
  );
}

export function addDesignVariantsCommand(
  designId: string,
  variants: DesignVariantInput[],
  idempotencyKey?: string,
): Dress[] {
  return runCommand(
    { name: 'design.add-variants', idempotencyKey, summarize: (pieces) => String(pieces.length) },
    () => {
      const pieces = addDesignVariants(designId, variants);
      commandBoundary('design.add-variants:after-write');
      return pieces;
    },
  );
}

export function assignPieceToDesignCommand(dressCode: string, designId: string, idempotencyKey?: string): Dress {
  return runCommand({ name: 'design.assign-piece', idempotencyKey }, () => {
    const dress = assignPieceToDesign(dressCode, designId);
    commandBoundary('design.assign-piece:after-write');
    return dress;
  });
}

export function archiveDesignCommand(designId: string, idempotencyKey?: string): DressDesign {
  return runCommand({ name: 'design.archive', idempotencyKey }, () => {
    const design = archiveDressDesign(designId);
    commandBoundary('design.archive:after-write');
    return design;
  });
}
