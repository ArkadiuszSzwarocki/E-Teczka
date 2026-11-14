import test from 'node:test';
import assert from 'node:assert/strict';
import { previewPosition } from '../src/utils/previewPosition.ts';

test('preview stays inside the viewport for thumbnails at top and bottom', () => {
  for (const top of [30, 700]) {
    const box = previewPosition({ top, left: 380, right: 436 }, 1536, 820);
    assert.equal(box.left, 444);
    assert.ok(box.top >= 8 && box.top + box.height <= 812);
    if (top === 30) assert.equal(box.top, 30);
  }
});

test('preview flips to the left and shrinks on smaller screens', () => {
  const box = previewPosition({ top: 400, left: 700, right: 756 }, 800, 500);
  assert.ok(box.left >= 8 && box.left + box.width <= 792);
  assert.ok(box.top >= 8 && box.top + box.height <= 492);
  assert.ok(box.left < 700);
});
