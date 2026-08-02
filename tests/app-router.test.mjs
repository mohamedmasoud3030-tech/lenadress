import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

async function read(path) {
  return readFile(join(root, path), 'utf8');
}

test('App delegates route ownership to the router package', async () => {
  const app = await read('src/app/App.tsx');

  assert.match(app, /import \{ AppRoutes \} from '@app\/router\/AppRoutes';/);
  assert.match(app, /<AppRoutes \/>/);
  assert.doesNotMatch(app, /<Routes>/);
  assert.doesNotMatch(app, /<Route\b/);
});

test('router preserves every current URL, shell boundary, lazy details route, and 404', async () => {
  const routes = await read('src/app/router/AppRoutes.tsx');
  const expectedRoutes = [
    '/landing',
    'inventory',
    'inventory/:code',
    'customers',
    'reservations',
    'appointments',
    'delivery-return',
    'payments',
    'expenses',
    'daily-closing',
    'audit-log',
    'reports',
    'preferences',
    '*',
  ];

  let cursor = -1;
  for (const route of expectedRoutes) {
    const next = routes.indexOf(`path="${route}"`, cursor + 1);
    assert.notEqual(next, -1, `Missing route: ${route}`);
    assert.ok(next > cursor, `Route order changed at: ${route}`);
    cursor = next;
  }

  assert.match(routes, /<RequireAuth>[\s\S]*?<AppShell \/>[\s\S]*?<\/RequireAuth>/);
  assert.match(routes, /path="\/login"/);
  assert.match(routes, /<Route index element={<DashboardWithClosingAlertPage \/>} \/>/);
  assert.match(routes, /<Suspense fallback={<RouteLoadingFallback \/>}>/);
  assert.match(routes, /<DressDetailsPage \/>/);
  assert.match(routes, /<Route path="\*" element={<NotFoundPage \/>} \/>/);
});

test('router keeps the inventory details page lazy and preserves the loading copy', async () => {
  const pages = await read('src/app/router/routePages.ts');
  const fallback = await read('src/app/router/RouteLoadingFallback.tsx');

  assert.match(pages, /export const DressDetailsPage = lazy/);
  assert.match(pages, /import\('\.\.\/\.\.\/features\/dresses\/DressDetailsPage'\)/);
  assert.match(fallback, /جاري تحميل تفاصيل العنصر…/);
  assert.match(fallback, /انتظر لحظة حتى يتم تجهيز بيانات الباركود والطباعة\./);
  assert.match(fallback, /role="status"/);
  assert.match(fallback, /aria-live="polite"/);
});
