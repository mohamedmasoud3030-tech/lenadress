import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { getSafeReturnPath, resolveAuthStatus } from '../src/features/auth/auth.model.ts';
import { toFriendlyAuthMessage } from '../src/features/auth/auth.service.ts';

const session = { user: { id: 'user-1' } };
const activeProfile = {
  id: 'user-1',
  fullName: 'مديرة المعرض',
  role: 'admin',
  isActive: true,
};

test('only a session with an active profile reaches protected routes', () => {
  assert.equal(resolveAuthStatus(null, null), 'signed-out');
  assert.equal(resolveAuthStatus(session, null), 'profile-missing');
  assert.equal(resolveAuthStatus(session, { ...activeProfile, isActive: false }), 'disabled');
  assert.equal(resolveAuthStatus(session, activeProfile), 'signed-in');
  assert.equal(resolveAuthStatus(session, activeProfile, true), 'auth-error');
});

test('post-login redirects stay inside the application', () => {
  assert.equal(getSafeReturnPath('/reservations?new=1#form'), '/reservations?new=1#form');
  assert.equal(getSafeReturnPath('https://evil.example'), '/');
  assert.equal(getSafeReturnPath('//evil.example'), '/');
  assert.equal(getSafeReturnPath(null), '/');
});

test('common Supabase failures have actionable Arabic messages', () => {
  assert.match(toFriendlyAuthMessage('Invalid login credentials'), /غير صحيحة/);
  assert.match(toFriendlyAuthMessage('Email not confirmed'), /تأكيد البريد/);
  assert.match(toFriendlyAuthMessage('Network request failed'), /الاتصال/);
  assert.match(toFriendlyAuthMessage('Rate limit exceeded'), /محاولات دخول كثيرة/);
});

test('the route guard preserves the full intended URL and blocks every non-active state', async () => {
  const source = await readFile(
    new URL('../src/app/router/RequireAuth.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /status !== 'signed-in'/);
  assert.match(source, /location\.pathname/);
  assert.match(source, /location\.search/);
  assert.match(source, /location\.hash/);
});
