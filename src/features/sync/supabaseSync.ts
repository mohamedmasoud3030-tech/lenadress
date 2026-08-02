/**
 * Compatibility-only image helper retained for older imports and tests.
 * Operational entity synchronization is implemented exclusively by the
 * revisioned showroom snapshot RPC in showroomCloudState.ts.
 */
export function getRemoteCatalogueImageUrl(images: string[] | undefined): string | null {
  for (const image of images ?? []) {
    try {
      const url = new URL(image);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString();
    } catch {
      // Ignore local data URLs and malformed values.
    }
  }
  return null;
}
