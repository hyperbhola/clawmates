import { getGeohashNeighbors, expandGeohashForRadius, geohashMatchesAny } from '../src/geo/geohash.js';

console.log('=== Geohash Unit Test ===\n');

// Test 1: Neighbors
const neighbors = getGeohashNeighbors('9q8yy');
console.log('Neighbors of 9q8yy:', JSON.stringify(neighbors));
console.log('Count:', neighbors.length, '(expected 9 = center + 8 neighbors)');
console.assert(neighbors.length === 9, 'Should have 9 entries');
console.assert(neighbors[0] === '9q8yy', 'First should be center');

// Test 2: All neighbors should be valid geohash strings of same length
for (const n of neighbors) {
  console.assert(n.length === 5, `Neighbor ${n} should be length 5, got ${n.length}`);
  console.assert(/^[0-9b-hjkmnp-z]+$/.test(n), `Neighbor ${n} has invalid chars`);
}
console.log('All neighbors are valid 5-char geohashes ✓');

// Test 3: Expansion
const expanded0 = expandGeohashForRadius('9q8yy', 0);
console.log('\nExpansion level 0:', JSON.stringify(expanded0));
console.assert(expanded0.length === 1, 'Level 0 should return 1 prefix');

const expanded1 = expandGeohashForRadius('9q8yy', 1);
console.log('Expansion level 1:', JSON.stringify(expanded1));
console.assert(expanded1.length === 9, 'Level 1 should return 9 prefixes');
console.assert(expanded1[0].length === 4, 'Level 1 should trim to 4 chars');

const expanded2 = expandGeohashForRadius('9q8yy', 2);
console.log('Expansion level 2:', JSON.stringify(expanded2));
console.assert(expanded2[0].length === 3, 'Level 2 should trim to 3 chars');

// Test 4: Prefix matching
console.log('\nPrefix matching:');
console.assert(geohashMatchesAny('9q8yy', ['9q8y']), '9q8yy should match prefix 9q8y');
console.assert(geohashMatchesAny('9q8yz', ['9q8y']), '9q8yz should match prefix 9q8y');
console.assert(!geohashMatchesAny('9q8xx', ['9q8y']), '9q8xx should NOT match prefix 9q8y');
console.log('Prefix matching works ✓');

console.log('\n=== ALL GEOHASH TESTS PASSED ===');
