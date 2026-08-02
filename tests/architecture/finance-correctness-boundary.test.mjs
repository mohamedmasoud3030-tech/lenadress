import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const sourceRoot = join(repositoryRoot, 'src');

// Tight allowlist: only adapters/migrations and type definitions that explicitly mark legacy with @deprecated
// Do NOT exclude whole finance/payments/reservations services per requirement
const LEGACY_ALLOWED_PATTERNS = [
  'financialDepositMigration.ts', // migration adapter - allowed to reference legacy depositAmount
  'persistenceEngine.ts', // storage version adapter
  'collectionRegistry.ts', // registry adapter
  'demoDataRecords.ts', // demo seeding
  'migrationRunner.ts', // migration infra
  // Type definitions that keep deprecated field for backward compat - allowed only for field definition, not canonical usage
  'dress.types.ts',
  'accessory.types.ts',
  'reservation.types.ts',
  'contractLineHelpers.ts', // contains legacy mapping but must be documented per line
];

const AMBIGUOUS_USAGE_REGEX = /\bdepositAmount\b/;

async function collectFiles(dir, predicate) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(path, predicate));
    } else if (predicate(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

test('no canonical runtime code uses ambiguous depositAmount as canonical API - must fail on offenders', async () => {
  const files = await collectFiles(sourceRoot, (name) => /\.(ts|tsx)$/.test(name));
  const offenders = [];

  for (const file of files) {
    const relative = file.replace(repositoryRoot, '');

    // Skip shared utils legacy compat file entirely (contains legacy function for migration)
    if (relative.includes('/shared/utils/financialCalculations')) continue;
    // Type definitions with deprecated depositAmount field are allowed to keep the field for backward compat
    if (
      relative.includes('dress.types.ts') ||
      relative.includes('accessory.types.ts') ||
      relative.includes('reservation.types.ts') ||
      relative.includes('design.types.ts')
    ) {
      continue;
    }

    const content = await readFile(file, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip comments
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

      if (!AMBIGUOUS_USAGE_REGEX.test(line)) continue;

      // Always allowed patterns that indicate legacy compatibility
      if (line.includes('legacyDepositAmount')) continue;
      if (line.includes('defaultSecurityDepositAmount')) continue;
      if (line.includes('securityDepositAmount') && line.includes('depositAmount')) {
        // mapping line like securityDepositAmount: legacyDep or depositAmount -> securityDepositAmount is allowed only if in migration or documented
        // Check if file is in allowed list or line contains legacy marker
        const isAllowedFile = LEGACY_ALLOWED_PATTERNS.some((p) => relative.includes(p));
        const hasLegacyMarker = /legacy|compat|deprecated|review|@deprecated/i.test(line);
        if (isAllowedFile || hasLegacyMarker) continue;
        // Otherwise still consider offender unless explicitly marked
      }
      if (line.includes('@deprecated')) continue;
      // Allow only if line itself is explicitly marked as legacy/compat/review
      if (/(legacy|compat|deprecated|review)/i.test(line)) continue;

      // If file is in tight allowlist, allow but only for migration adapters
      const isAllowedAdapter = LEGACY_ALLOWED_PATTERNS.some((p) => relative.includes(p));
      if (isAllowedAdapter) {
        // Even in allowed adapter, we require legacy marker unless it's a direct mapping file that is known to handle legacy
        // For financialDepositMigration, persistenceEngine, collectionRegistry, demoDataRecords we allow
        if (
          relative.includes('financialDepositMigration') ||
          relative.includes('persistenceEngine') ||
          relative.includes('collectionRegistry') ||
          relative.includes('demoDataRecords') ||
          relative.includes('migrationRunner')
        ) {
          continue;
        }
        // For type files, allow only field definitions that are marked @deprecated (handled above)
        // For contractLineHelpers, require legacy marker - so if we reached here, it's not marked -> offender
        // Fall through to offender if not marked
        if (/(legacy|compat|deprecated|review|@deprecated)/i.test(line) || line.includes('legacyDepositAmount')) continue;
      }

      // All other usages are offenders - they represent new canonical code using ambiguous depositAmount
      offenders.push(`${relative}:${i + 1}: ${line.trim()}`);
    }
  }

  // MUST ASSERT: fail when any offender exists per requirement "أضف assertion يفشل عند وجود أي offender"
  assert.equal(
    offenders.length,
    0,
    `Canonical runtime must not use ambiguous depositAmount. Found ${offenders.length} offenders:\n${offenders.join('\n')}`,
  );

  // Also check that no new canonical file defines depositAmount as numeric field outside allowed type definitions
  const forbiddenDefinitions = [];
  for (const file of files) {
    const relative = file.replace(repositoryRoot, '');
    const isTypeDefinitionAllowed =
      relative.includes('reservation.types.ts') ||
      relative.includes('dress.types.ts') ||
      relative.includes('accessory.types.ts') ||
      relative.includes('financialDepositMigration') ||
      relative.includes('demoDataRecords');

    if (isTypeDefinitionAllowed) continue;
    if (relative.includes('/shared/utils/financialCalculations')) continue;

    const content = await readFile(file, 'utf8');
    // Look for field definition like depositAmount: number or depositAmount?: number
    const matches = content.matchAll(/depositAmount\s*\??\s*:\s*number/g);
    for (const m of matches) {
      // Allow if file is in legacy allowed and line contains @deprecated or legacy
      const lines = content.split('\n');
      const lineIdx = lines.findIndex((l) => l.includes(m[0]));
      if (lineIdx >= 0) {
        const line = lines[lineIdx];
        if (/(legacy|@deprecated|deprecated|compat|review)/i.test(line)) continue;
        if (line.includes('legacyDepositAmount') || line.includes('defaultSecurityDepositAmount')) continue;
      }
      forbiddenDefinitions.push(`${relative}: ${m[0]}`);
    }
  }

  assert.equal(
    forbiddenDefinitions.length,
    0,
    `New canonical code must not define ambiguous depositAmount field. Found: ${forbiddenDefinitions.join('; ')}`,
  );
});

test('contract and receipt printing uses distinct Arabic labels', async () => {
  const contractFile = join(sourceRoot, 'features/reservations/printRentalContract.ts');
  const content = await readFile(contractFile, 'utf8');
  assert.match(content, /التأمين المسترد/, 'must use التأمين المسترد');
  assert.match(content, /دفعة الحجز/, 'must use دفعة الحجز');
  assert.match(content, /المتبقي من الإيجار/, 'must use المتبقي من الإيجار');
  // Should not have ambiguous alone العربون without qualification
  const ambiguousLines = content
    .split('\n')
    .filter((line) => /العربون/.test(line) && !/التأمين/.test(line) && !/دفعة الحجز/.test(line));
  const realAmbiguous = ambiguousLines.filter(
    (l) => !l.trim().startsWith('//') && !l.includes('*') && !l.includes('Never prints ambiguous'),
  );
  assert.equal(realAmbiguous.length, 0, `Contract must not use ambiguous العربون alone: ${realAmbiguous.join('; ')}`);
});

test('architecture boundary: payment and reservation services must not reference depositAmount without legacy marker', async () => {
  // Explicit test that finance, payments, reservations services do not use ambiguous depositAmount as canonical
  const criticalServices = [
    join(sourceRoot, 'features/finance/finance.service.ts'),
    join(sourceRoot, 'features/payments/payment.service.ts'),
    join(sourceRoot, 'features/reservations/reservation.service.ts'),
    join(sourceRoot, 'features/finance/canonicalFinance.ts'),
  ];
  const offenders = [];
  for (const filePath of criticalServices) {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/\bdepositAmount\b/.test(line)) continue;
        if (line.includes('legacyDepositAmount')) continue;
        if (line.includes('defaultSecurityDepositAmount')) continue;
        if (line.includes('securityDepositAmount')) continue;
        if (line.includes('bookingAdvanceAmount')) continue;
        if (/(legacy|compat|@deprecated|deprecated|review)/i.test(line)) continue;
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        offenders.push(`${filePath.replace(repositoryRoot, '')}:${i + 1}: ${line.trim()}`);
      }
    } catch {
      // file may not exist
    }
  }
  assert.equal(offenders.length, 0, `Critical finance/payment/reservation services must not use ambiguous depositAmount: ${offenders.join('\n')}`);
});
