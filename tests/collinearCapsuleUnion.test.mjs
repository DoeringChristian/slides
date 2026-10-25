import { test } from 'vitest';
import assert from 'node:assert/strict';
import { collinearCapsuleUnion, capsuleUnionBoundaryDistance } from './collinearCapsuleUnion.js';
const capsule = (lo, hi = lo) => ({ lo, hi, radius: 10 });
test('contained fragment boundary cannot exempt pixel130,40 from exact core', () => {
  const union = collinearCapsuleUnion([capsule(106 + 2 / 3, 140), capsule(140), capsule(40)]);
  assert.deepEqual(union, [capsule(40), capsule(106 + 2 / 3, 140)]);
  assert.equal(capsuleUnionBoundaryDistance(union, 130.5, .5), 9.5);
  assert.ok(capsuleUnionBoundaryDistance([capsule(140)], 130.5, .5) < 2);
});
test('overlapping centerline intervals merge, including partial overlap and duplicates', () => {
  const union = collinearCapsuleUnion([capsule(0, 10), capsule(5, 20), capsule(20, 30), capsule(0, 10)]);
  assert.deepEqual(union, [capsule(0, 30)]);
  assert.equal(capsuleUnionBoundaryDistance(union, 10, 0), 10);
});
test('overlapping circles with internal near boundaries are explicitly unsupported', () => {
  const circles = [capsule(-9), capsule(9)];
  // Individual boundary distance1 is wrong: exposed arcs meet at (0,+/-sqrt19),
  // and their closest exposed points to the origin have distance sqrt19 > 2.
  assert.equal(capsuleUnionBoundaryDistance(circles, 0, 0), 1);
  assert.ok(Math.sqrt(19) > 2);
  assert.throws(() => collinearCapsuleUnion(circles), /Unsupported overlapping caps/);
  assert.throws(() => collinearCapsuleUnion([capsule(-10), capsule(10)]), /Unsupported overlapping caps/);
});
test('disjoint cap and shaft preserve original endpoint AA boundary evidence', () => {
  const union = collinearCapsuleUnion([capsule(40), capsule(106 + 2 / 3, 140)]);
  assert.ok(Math.abs(capsuleUnionBoundaryDistance(union, 45.5, -7.5) - .6994623811308642) < 1e-12);
  assert.ok(capsuleUnionBoundaryDistance(union, 70.5, .5) > 2);
});
test('uncertified radius or interval geometry fails closed', () => {
  for (const capsules of [[], [capsule(NaN)], [capsule(2, 1)], [{lo:0,hi:1,radius:0}], [capsule(0), {lo:30,hi:30,radius:9}]]) {
    assert.throws(() => collinearCapsuleUnion(capsules));
  }
});
