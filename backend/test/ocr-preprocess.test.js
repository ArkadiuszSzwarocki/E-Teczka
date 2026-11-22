const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { preprocessOcrImage } = require('../services/ocrPreprocess');

test('preprocessOcrImage upscales small images, normalizes contrast, and outputs valid PNG', async () => {
  const canvas = createCanvas(600, 160);
  const ctx = canvas.getContext('2d');
  // Simulate a low-contrast gray photo/receipt
  ctx.fillStyle = '#c8c8c8';
  ctx.fillRect(0, 0, 600, 160);
  ctx.fillStyle = '#5a5a5a';
  ctx.font = '48px Arial';
  ctx.fillText('PARAGON 456', 40, 100);

  const input = canvas.toBuffer('image/png');
  const output = await preprocessOcrImage(input);
  const decoded = await loadImage(output);

  assert.ok(decoded.width >= 1500, `Expected upscaled width >= 1500, got ${decoded.width}`);

  // Verify background is brightened to pure white (255)
  const outCanvas = createCanvas(decoded.width, decoded.height);
  const outCtx = outCanvas.getContext('2d');
  outCtx.drawImage(decoded, 0, 0);
  const corner = outCtx.getImageData(2, 2, 1, 1).data;
  assert.equal(corner[0], 255);
  assert.equal(corner[1], 255);
  assert.equal(corner[2], 255);
});
