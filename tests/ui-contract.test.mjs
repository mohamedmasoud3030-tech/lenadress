import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(repositoryRoot, 'src');

async function collectFiles(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path, predicate)));
    } else if (predicate(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

const isComponent = (name) => name.endsWith('.tsx');

test('the document shell is Arabic-first and RTL', async () => {
  const html = await readFile(join(repositoryRoot, 'index.html'), 'utf8');
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /width=device-width, initial-scale=1\.0/);

  const shell = await readFile(join(sourceRoot, 'app/shell/AppShell.tsx'), 'utf8');
  assert.match(shell, /dir="rtl"/);
});

test('global styles guard against horizontal overflow on small phones', async () => {
  const css = await readFile(join(sourceRoot, 'styles/global.css'), 'utf8');
  assert.match(css, /min-width:\s*320px/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /overflow-wrap:\s*anywhere/, 'long codes and notes must wrap instead of widening the page');
});

test('the app shell reserves space for the mobile bottom navigation and the safe area', async () => {
  const shell = await readFile(join(sourceRoot, 'app/shell/AppShell.tsx'), 'utf8');
  assert.match(shell, /min-w-0/, 'flex/grid children must not force horizontal overflow');
  assert.match(shell, /safe-area-inset-bottom/);

  const mobileNav = await readFile(join(sourceRoot, 'app/shell/MobileNavigation.tsx'), 'utf8');
  assert.match(mobileNav, /fixed inset-x-0 bottom-0/);
  assert.match(mobileNav, /lg:hidden/);
  assert.match(mobileNav, /safe-area-inset-bottom/);
  assert.match(mobileNav, /min-h-14/, 'tap targets must stay comfortable on phones');
  assert.match(mobileNav, /aria-label=/);
});

test('the modal scrolls its body, traps focus and is labelled', async () => {
  const modal = await readFile(join(sourceRoot, 'components/shared/Modal.tsx'), 'utf8');
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-labelledby=/);
  assert.match(modal, /event\.key === 'Escape'/);
  assert.match(modal, /event\.key !== 'Tab'/, 'the dialog must trap Tab focus');
  assert.match(modal, /overflow-y-auto overscroll-contain/, 'the body scrolls without scrolling the page behind');
  assert.match(modal, /max-h-\[100dvh\]/, 'phone keyboards must not push content out of reach');
});

test('unified Empty, Loading and Error states exist and are Arabic', async () => {
  const states = await readFile(join(sourceRoot, 'components/shared/StateViews.tsx'), 'utf8');
  assert.match(states, /export function EmptyState/);
  assert.match(states, /export function LoadingState/);
  assert.match(states, /export function ErrorState/);
  assert.match(states, /role="status"/);
  assert.match(states, /aria-live="polite"/);
  assert.match(states, /role="alert"/);
  assert.match(states, /جارٍ التحميل/);
  assert.match(states, /إعادة المحاولة/);
});

test('no English placeholder scaffolding is shipped to the showroom', async () => {
  const components = await collectFiles(sourceRoot, isComponent);
  const offenders = [];
  for (const file of components) {
    const content = await readFile(file, 'utf8');
    if (/In progress<\/p>|This page is part of the approved roadmap/.test(content)) {
      offenders.push(file.replace(repositoryRoot, ''));
    }
  }
  assert.deepEqual(offenders, []);
});

test('every icon-only control carries an accessible Arabic label', async () => {
  const components = await collectFiles(sourceRoot, isComponent);
  const offenders = [];

  for (const file of components) {
    const content = await readFile(file, 'utf8');
    // Buttons whose only child is an icon element must be labelled.
    const iconOnlyButtons = content.match(/<button[^>]*>\s*<[A-Z][A-Za-z]*\s[^>]*\/>\s*<\/button>/g) ?? [];
    for (const button of iconOnlyButtons) {
      if (!/aria-label=|aria-labelledby=/.test(button)) {
        offenders.push(`${file.replace(repositoryRoot, '')}: ${button.slice(0, 80)}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test('destructive and money-changing submits are guarded against double submit', async () => {
  const guarded = [
    'features/payments/AddPaymentModal.tsx',
    'features/delivery-return/DeliveryReturnModal.tsx',
    'features/dresses/SellDressModal.tsx',
    'features/service/OpenServiceTaskModal.tsx',
    'features/service/CompleteServiceTaskModal.tsx',
  ];

  for (const relative of guarded) {
    const content = await readFile(join(sourceRoot, relative), 'utf8');
    assert.match(content, /isSubmitting/, `${relative} must track submission state`);
    assert.match(content, /isSubmitting\) return;/, `${relative} must ignore a second submit`);
    assert.match(content, /idempotencyKey/, `${relative} must send an idempotency key`);
    assert.match(content, /disabled=\{[^}]*isSubmitting/, `${relative} must disable its submit button`);
  }
});

test('the daily operations journey is reachable from the navigation', async () => {
  const navigation = await readFile(join(sourceRoot, 'app/shell/navigation.ts'), 'utf8');
  const routes = await readFile(join(sourceRoot, 'app/router/AppRoutes.tsx'), 'utf8');

  const required = [
    '/inventory',
    '/customers',
    '/reservations',
    '/delivery-return',
    '/sales',
    '/service',
    '/payments',
    '/expenses',
    '/daily-closing',
    '/reports',
    '/preferences',
  ];

  for (const route of required) {
    assert.ok(navigation.includes(`'${route}'`), `${route} must be reachable from the navigation`);
    assert.ok(
      routes.includes(`path="${route.slice(1)}"`) || route === '/',
      `${route} must have a route`,
    );
  }
});
