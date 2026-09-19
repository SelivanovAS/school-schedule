const test = require('node:test');
const assert = require('node:assert/strict');
const { validateFile } = require('../homework-photos.js');
test('photo input allows supported raster images and rejects empty, oversized and active formats', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic']) assert.doesNotThrow(() => validateFile({ type, size: 100 }));
  for (const type of ['image/svg+xml', 'text/html', 'application/pdf']) assert.throws(() => validateFile({ type, size: 100 }), /Поддерживаются/);
  for (const size of [0, 21 * 1024 * 1024]) assert.throws(() => validateFile({ type: 'image/jpeg', size }), /20 МБ/);
});
