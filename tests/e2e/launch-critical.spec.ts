import { expect, test, type Page } from '@playwright/test';

const userId = '11111111-1111-4111-8111-111111111111';

async function mockAuthenticatedStaff(page: Page) {
  await page.routeWebSocket('**/realtime/v1/websocket**', (socket) => socket.close());
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'staff@example.test',
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
  };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    aud: 'authenticated',
    exp: expiresAt,
    sub: userId,
    email: user.email,
    role: 'authenticated',
  })}.test-signature`;
  await page.route('**/auth/v1/token**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      access_token: accessToken,
      refresh_token: 'test-refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expiresAt,
      user,
    }),
  }));
  await page.route('**/rest/v1/profiles**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'content-range': '0-0/1' },
    body: JSON.stringify({ id: userId, full_name: 'موظفة اختبار', role: 'staff', is_active: true }),
  }));
  await page.route('**/rest/v1/showroom_state**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'content-range': '0-0/1' },
    body: JSON.stringify({
      revision: 1,
      updated_at: '2026-01-01T00:00:00.000Z',
      snapshot: { applicationId: 'dress-roomshow', schemaVersion: 3, collections: {} },
    }),
  }));
  await page.route('**/rest/v1/client_error_events**', (route) => route.fulfill({ status: 201, body: '' }));
}

test('public catalogue stays customer-facing and sends an identifiable booking request', async ({ page }) => {
  await page.route('**/rest/v1/catalogue_items**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{
      id: 'dress-public-1',
      code: 'D-101',
      name: 'فستان سهرة كحلي',
      description: 'فستان سهرة أنيق',
      category: 'سهرة',
      color: 'كحلي',
      size: 'M',
      item_type: 'dress',
      rental_price: 50,
      sale_price: 0,
      security_deposit_amount: 20,
      status: 'available',
      is_for_rent: true,
      is_for_sale: false,
      images: [],
    }]),
  }));

  await page.goto('/landing');
  await expect(page.getByRole('heading', { name: 'المعروض الآن' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'فستان سهرة كحلي' })).toBeVisible();
  await expect(page.getByText('متاح للطلب', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'صورة توضيحية لفئة سهرة' })).toBeVisible();

  for (const developerCopy of ['قابلة للتخصيص', 'لكل عميل يشتري التطبيق', 'متصل بالبيانات الفعلية', 'إعادة البيع']) {
    await expect(page.getByText(developerCopy, { exact: false })).toHaveCount(0);
  }

  const bookingHref = await page.getByRole('link', { name: 'طلب موعد للتجربة' }).getAttribute('href');
  expect(decodeURIComponent(bookingHref ?? '')).toContain('الكود: D-101');
  expect(decodeURIComponent(bookingHref ?? '')).toContain('أرجو تأكيد الموعد وتوفر القطعة');

  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);
});

test('deep operational links return the SPA shell and enforce login', async ({ page }) => {
  const response = await page.goto('/reservations');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'LENA' })).toBeVisible();
});

test('PWA shell installs its manifest, survives offline reload, and does not overflow', async ({ page, context }) => {
  await page.goto('/login');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'LENA' })).toBeVisible();
});

test('authenticated staff hydrates cloud state and cannot open administrator settings', async ({ page }) => {
  await mockAuthenticatedStaff(page);
  await page.goto('/login');
  await page.getByLabel('البريد الإلكتروني').fill('staff@example.test');
  await page.getByLabel('كلمة المرور').fill('valid-test-password');
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByRole('heading', { name: 'تأمين هذا الجهاز' })).toBeVisible();
  await page.getByLabel('رقم القفل الجديد').fill('123456');
  await page.getByLabel('تأكيد رقم القفل').fill('123456');
  await page.getByRole('button', { name: 'تأمين الجهاز والمتابعة' }).click();
  await expect(page.getByRole('heading', { name: 'لوحة التحكم', exact: true })).toBeVisible();
  await expect(page.getByText('الإعدادات والنسخ', { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    window.history.pushState({}, '', '/preferences');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'النسخ الاحتياطي وإعدادات التشغيل' })).toHaveCount(0);
});
