import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

/**
 * PWA runtime evidence taken from the real build output.
 *
 * These assertions caught two genuine defects: the Arabic font `@import`s were
 * placed after `@tailwind`, so PostCSS silently dropped them and no font was
 * bundled at all; and the service worker did not precache fonts or provide a
 * navigation fallback, so an offline reload lost both the Arabic font and the
 * app shell.
 *
 * The suite is skipped when `dist/` has not been built yet, so it never blocks a
 * plain unit-test run; the `test:pwa` script builds first.
 */

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const distRoot = join(repositoryRoot, 'dist');

async function distExists() {
  try {
    await access(join(distRoot, 'sw.js'));
    return true;
  } catch {
    return false;
  }
}

const built = await distExists();
const runIf = { skip: built ? false : 'dist/ is not built; run npm run build first' };

test('the Arabic font imports precede every other CSS statement', async () => {
  const css = await readFile(join(repositoryRoot, 'src/styles/global.css'), 'utf8');
  const firstImport = css.indexOf("@import '@fontsource");
  const firstTailwind = css.indexOf('@tailwind');
  assert.ok(firstImport !== -1, 'the Arabic font must be imported');
  assert.ok(
    firstImport < firstTailwind,
    '@import must precede @tailwind, otherwise PostCSS drops the font entirely',
  );
});

test('the PWA manifest is Arabic, RTL and installable', runIf, async () => {
  const manifest = JSON.parse(await readFile(join(distRoot, 'manifest.webmanifest'), 'utf8'));

  assert.equal(manifest.lang, 'ar');
  assert.equal(manifest.dir, 'rtl');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.ok(manifest.name && manifest.short_name);

  const sizes = manifest.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes('192x192'), 'a 192px icon is required for installability');
  assert.ok(sizes.includes('512x512'), 'a 512px icon is required for installability');
  assert.ok(
    manifest.icons.some((icon) => icon.purpose === 'maskable'),
    'a maskable icon is required for a proper home-screen icon',
  );
});

test('every manifest icon actually exists in the build output', runIf, async () => {
  const manifest = JSON.parse(await readFile(join(distRoot, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) {
    await access(join(distRoot, icon.src.replace(/^\//, '')));
  }
});

test('the Arabic font is actually bundled, not left as a remote dependency', runIf, async () => {
  const assets = await readdir(join(distRoot, 'assets'));
  const fonts = assets.filter((name) => name.endsWith('.woff2'));
  assert.ok(fonts.length > 0, 'the Arabic font must be bundled for offline use');
  assert.ok(
    fonts.some((name) => name.includes('noto-sans-arabic')),
    'the bundled font must be the Arabic face used by the interface',
  );

  const cssFile = assets.find((name) => name.endsWith('.css'));
  const css = await readFile(join(distRoot, 'assets', cssFile), 'utf8');
  assert.match(css, /@font-face/, 'the stylesheet must declare the bundled font');
  assert.doesNotMatch(css, /https:\/\/fonts\.googleapis\.com/, 'no remote font dependency is allowed offline');
});

test('the service worker precaches the shell and the Arabic font for offline reload', runIf, async () => {
  const serviceWorker = await readFile(join(distRoot, 'sw.js'), 'utf8');

  const precachedFonts = serviceWorker.match(/"assets\/[^"]*\.woff2"/g) ?? [];
  assert.ok(precachedFonts.length > 0, 'an offline reload must not fall back to a system font');

  assert.match(serviceWorker, /"index\.html"/, 'the app shell must be precached');
  assert.match(serviceWorker, /"manifest\.webmanifest"/);
  assert.match(
    serviceWorker,
    /createHandlerBoundToURL/,
    'navigations must fall back to the cached shell instead of the browser offline page',
  );
});

test('the built document stays Arabic-first and RTL', runIf, async () => {
  const html = await readFile(join(distRoot, 'index.html'), 'utf8');
  assert.match(html, /<html lang="ar" dir="rtl">/);
});

test('the built bundle actually registers the service worker', runIf, async () => {
  // Registration moved out of an inline snippet in index.html and into the
  // application bundle when the app took control of *when* an update applies.
  // It is asserted against the built assets rather than the HTML, because an
  // earlier attempt used `@vite-ignore` on the virtual module: the app still
  // built and still looked correct, but the specifier was never resolved and
  // the service worker was silently never registered — the PWA simply stopped
  // working offline.
  const assetsRoot = join(distRoot, 'assets');
  const files = await readdir(assetsRoot);
  const scripts = files.filter((name) => name.endsWith('.js'));

  const contents = await Promise.all(scripts.map((name) => readFile(join(assetsRoot, name), 'utf8')));
  const registersWorker = contents.some((content) => /serviceWorker/.test(content));
  assert.ok(registersWorker, 'the service worker registration must survive into the build');
});

test('the service worker waits for the operator instead of self-applying', runIf, async () => {
  const config = await readFile(join(repositoryRoot, 'vite.config.ts'), 'utf8');
  // autoUpdate swapped the running app the moment a build was cached, which can
  // replace a half-filled booking form while a customer waits.
  assert.match(config, /registerType: 'prompt'/, 'updates must be prompted, not forced');
  assert.doesNotMatch(config, /registerType: 'autoUpdate'/);
});
