/**
 * Build identity.
 *
 * Support was impossible: asked "which version are you on?", the operator had
 * no answer, because nothing in the interface stated one. Two showrooms on two
 * different builds reporting the same symptom were indistinguishable.
 *
 * The values are injected at build time by Vite's `define`, so they describe
 * the bundle actually running rather than whatever `package.json` says in the
 * repository at the moment someone looks.
 */

export type AppBuildInfo = {
  version: string;
  /** ISO timestamp of the build, or an empty string in a dev runtime. */
  buildTime: string;
  /** `1.0.0 · 2026-07-29`, ready to display. */
  label: string;
};

export function getAppBuildInfo(): AppBuildInfo {
  // Guarded because the constants are absent under the test runner and any
  // non-Vite host, where a bare reference would throw a ReferenceError.
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
  const buildTime = typeof __APP_BUILD_TIME__ === 'string' ? __APP_BUILD_TIME__ : '';
  const datePart = buildTime ? buildTime.slice(0, 10) : '';

  return {
    version,
    buildTime,
    label: datePart ? `${version} · ${datePart}` : version,
  };
}
