import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const sourceRoot = join(repositoryRoot, 'src');

const aliases = {
  '@app': join(sourceRoot, 'app'),
  '@modules': join(sourceRoot, 'modules'),
  '@engines': join(sourceRoot, 'engines'),
  '@platform': join(sourceRoot, 'platform'),
  '@shared': join(sourceRoot, 'shared'),
};

// Quarantined areas the official Web/PWA runtime must never depend on.
// They stay in the repository temporarily for compatibility and historical
// recovery (docs/adr/0001-web-pwa-supabase-only.md), outside the release.
const desktopIslandRoot = join(sourceRoot, 'platform', 'desktop');
const tauriRuntimeRoot = join(sourceRoot, 'platform', 'runtime');
const legacyDesktopService = join(sourceRoot, 'services', 'desktopDatabase');

// The official Web/PWA dependency surface: everything reachable from the
// Vite entry point lives under these roots.
const webSurfaceDirectories = ['app', 'pages', 'features', 'components'];
const entryPointPattern = /^main\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(path) {
  if (!(await exists(path))) return [];

  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) return walk(entryPath);
      if (!entry.isFile()) return [];
      const extension = entry.name.slice(entry.name.lastIndexOf('.'));
      return sourceExtensions.has(extension) ? [entryPath] : [];
    }),
  );

  return nested.flat();
}

function extractImportSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }

  return [...specifiers];
}

function resolveInternalImport(sourceFile, specifier) {
  for (const [alias, aliasRoot] of Object.entries(aliases)) {
    if (specifier === alias) return aliasRoot;
    if (specifier.startsWith(`${alias}/`)) return join(aliasRoot, specifier.slice(alias.length + 1));
  }

  if (specifier.startsWith('.')) return resolve(dirname(sourceFile), specifier);
  return null;
}

function describeForbiddenSpecifier(specifier) {
  if (/^@tauri-apps(?:\/|$)/.test(specifier)) return 'Tauri API package';
  if (specifier === '@platform/desktop' || specifier.startsWith('@platform/desktop/')) {
    return 'Desktop island';
  }
  if (specifier === '@platform/runtime' || specifier.startsWith('@platform/runtime/')) {
    return 'Tauri runtime adapter';
  }
  if (/(?:^|\/)services\/desktopDatabase$/.test(specifier) || /desktopDatabase/.test(specifier)) {
    return 'Desktop bootstrap module';
  }
  return null;
}

function describeForbiddenResolvedPath(targetPath) {
  if (targetPath === desktopIslandRoot || targetPath.startsWith(`${desktopIslandRoot}${sep}`)) {
    return 'Desktop island';
  }
  if (targetPath === tauriRuntimeRoot || targetPath.startsWith(`${tauriRuntimeRoot}${sep}`)) {
    return 'Tauri runtime adapter';
  }
  const extension = targetPath.includes('.') ? targetPath.slice(targetPath.lastIndexOf('.')) : '';
  const withoutExtension = extension ? targetPath.slice(0, -extension.length) : targetPath;
  if (
    targetPath === legacyDesktopService ||
    (sourceExtensions.has(extension) && withoutExtension === legacyDesktopService)
  ) {
    return 'Desktop bootstrap module';
  }
  return null;
}

async function collectWebSurfaceFiles() {
  const files = [];

  const sourceEntries = await readdir(sourceRoot, { withFileTypes: true });
  for (const entry of sourceEntries) {
    if (entry.isFile() && entryPointPattern.test(entry.name)) {
      files.push(join(sourceRoot, entry.name));
    }
  }

  for (const directory of webSurfaceDirectories) {
    files.push(...(await walk(join(sourceRoot, directory))));
  }

  return files;
}

test('official Web/PWA surface never imports Desktop or Tauri modules', async () => {
  const files = await collectWebSurfaceFiles();
  assert.ok(files.length > 0, 'Web surface scan found no files; the boundary is not protected');

  const violations = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const specifier of extractImportSpecifiers(source)) {
      const directViolation = describeForbiddenSpecifier(specifier);
      if (directViolation) {
        violations.push(`${relative(repositoryRoot, file)} imports ${specifier} (${directViolation})`);
        continue;
      }

      const targetPath = resolveInternalImport(file, specifier);
      if (!targetPath) continue;
      const resolvedViolation = describeForbiddenResolvedPath(targetPath);
      if (resolvedViolation) {
        violations.push(`${relative(repositoryRoot, file)} imports ${specifier} (${resolvedViolation})`);
      }
    }
  }

  assert.deepEqual(violations, [], `Web/PWA boundary violations:\n${violations.join('\n')}`);
});

test('App.tsx cannot reintroduce a Desktop side-effect import', async () => {
  const appPath = join(sourceRoot, 'app', 'App.tsx');
  const source = await readFile(appPath, 'utf8');

  const offenders = extractImportSpecifiers(source).filter((specifier) =>
    /desktop|tauri/i.test(specifier),
  );
  assert.deepEqual(offenders, [], `App.tsx imports forbidden specifiers: ${offenders.join(', ')}`);
  assert.doesNotMatch(source, /import\s+['"][^'"]*(?:desktop|tauri)[^'"]*['"]/i);
});
