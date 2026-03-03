/**
 * Geohash utilities for ClawMates.
 *
 * Geohash precision reference:
 *   1 char = ~5000km
 *   2 chars = ~1250km
 *   3 chars = ~156km
 *   4 chars = ~40km
 *   5 chars = ~5km    ← default agent precision
 *   6 chars = ~1.2km
 *   7 chars = ~150m
 *   8 chars = ~40m
 *
 * We never work with raw lat/lng. Agents publish geohashes,
 * and the server matches based on geohash prefix overlap.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Get all geohash neighbors at the same precision level.
 * Returns the 8 surrounding geohashes + the center.
 */
export function getGeohashNeighbors(geohash: string): string[] {
  if (geohash.length === 0) return [geohash];

  const neighbors = [
    neighbor(geohash, 'n'),
    neighbor(geohash, 'ne'),
    neighbor(geohash, 'e'),
    neighbor(geohash, 'se'),
    neighbor(geohash, 's'),
    neighbor(geohash, 'sw'),
    neighbor(geohash, 'w'),
    neighbor(geohash, 'nw'),
  ].filter(Boolean) as string[];

  return [geohash, ...neighbors];
}

/**
 * Expand a geohash prefix to cover a wider area.
 * Removing chars from the end increases the area covered.
 *
 * expansionLevel 0 = exact prefix
 * expansionLevel 1 = remove 1 char (wider area + neighbors)
 * expansionLevel 2 = remove 2 chars (much wider + neighbors)
 */
export function expandGeohashForRadius(
  geohashPrefix: string,
  expansionLevel: number,
): string[] {
  const trimmed = geohashPrefix.slice(0, Math.max(2, geohashPrefix.length - expansionLevel));

  if (expansionLevel === 0) {
    return [trimmed];
  }

  return getGeohashNeighbors(trimmed);
}

/**
 * Check if a geohash falls within any of the target prefixes.
 */
export function geohashMatchesAny(geohash: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => geohash.startsWith(prefix));
}

// --- Internal helpers ---
// Standard geohash neighbor lookup tables.
// Reference: https://github.com/davetcoleman/geohash-js

type Direction = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

const NEIGHBORS: Record<string, Record<string, string>> = {
  n: { even: 'p0r21436x8zb9dcf5h7kjnmqesgutwvy', odd: 'bc01fg45238967deuvhjyznpkmstqrwx' },
  s: { even: '14365h7k9dcfesgujnmqp0r2twvyx8zb', odd: '238967debc01fg45uvhjyznpkmstqrwx' },
  e: { even: 'bc01fg45238967deuvhjyznpkmstqrwx', odd: 'p0r21436x8zb9dcf5h7kjnmqesgutwvy' },
  w: { even: '238967debc01fg45uvhjyznpkmstqrwx', odd: '14365h7k9dcfesgujnmqp0r2twvyx8zb' },
};

const BORDERS: Record<string, Record<string, string>> = {
  n: { even: 'prxz', odd: 'bcfguvyz' },
  s: { even: '028b', odd: '0145hjnp' },
  e: { even: 'bcfguvyz', odd: 'prxz' },
  w: { even: '0145hjnp', odd: '028b' },
};

function neighbor(geohash: string, direction: Direction): string | null {
  // Handle diagonal directions by composing cardinal directions
  if (direction.length === 2) {
    const first = neighbor(geohash, direction[0] as Direction);
    if (!first) return null;
    return neighbor(first, direction[1] as Direction);
  }

  if (geohash.length === 0) return null;

  const lastChar = geohash[geohash.length - 1];
  const parent = geohash.slice(0, -1);
  const parity = geohash.length % 2 === 0 ? 'even' : 'odd';

  const borderStr = BORDERS[direction]?.[parity];
  const neighborStr = NEIGHBORS[direction]?.[parity];

  if (!borderStr || !neighborStr) return null;

  // Check if we need to recurse to the parent
  if (borderStr.includes(lastChar)) {
    if (parent.length === 0) return null;
    const newParent = neighbor(parent, direction);
    if (!newParent) return null;
    return newParent + BASE32[neighborStr.indexOf(lastChar)];
  }

  const idx = neighborStr.indexOf(lastChar);
  if (idx === -1) return null;
  return parent + BASE32[idx];
}
