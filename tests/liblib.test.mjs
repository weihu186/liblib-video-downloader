import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertTrustedMediaUrl,
  extractDetail,
  parseLiblibUrl,
  safeFileName,
  selectDownloadStrategy,
} from '../src/liblib.mjs';

test('parses a canonical Liblib detail URL', () => {
  assert.equal(
    parseLiblibUrl('https://www.liblib.tv/detail/31b600ea119b48e0bf69ca0672d18856'),
    '31b600ea119b48e0bf69ca0672d18856',
  );
});

test('rejects non-Liblib and malformed detail URLs', () => {
  assert.throws(() => parseLiblibUrl('https://example.com/detail/31b600ea119b48e0bf69ca0672d18856'));
  assert.throws(() => parseLiblibUrl('https://www.liblib.tv/detail/not-an-id'));
});

test('extracts the public project fields from the detail response', () => {
  const result = extractDetail({
    code: 0,
    data: {
      detail: {
        name: '坠星 / DROPFALL EP1',
        description: '原创短片',
        coverUrl: 'https://liblibai-online.liblib.cloud/a.png',
        finalOutput: 'https://libtv-res.liblib.art/a.mp4',
      },
    },
  });
  assert.deepEqual(result, {
    title: '坠星 / DROPFALL EP1',
    description: '原创短片',
    coverUrl: 'https://liblibai-online.liblib.cloud/a.png',
    directUrl: 'https://libtv-res.liblib.art/a.mp4',
    hlsUrl: null,
  });
});

test('allows only trusted Liblib media hosts', () => {
  assert.equal(assertTrustedMediaUrl('https://libtv-res.liblib.art/a.mp4').hostname, 'libtv-res.liblib.art');
  assert.throws(() => assertTrustedMediaUrl('https://evil.example/a.mp4'));
  assert.throws(() => assertTrustedMediaUrl('http://libtv-res.liblib.art/a.mp4'));
});

test('creates a safe non-empty filename', () => {
  assert.equal(safeFileName('  坠星 / DROPFALL: EP1  '), '坠星-DROPFALL-EP1');
  assert.equal(safeFileName('...'), 'liblib-video');
});

test('prefers a direct MP4 and falls back to HLS', () => {
  assert.deepEqual(selectDownloadStrategy({ directUrl: 'https://libtv-res.liblib.art/a.mp4', hlsUrl: 'https://libtv-res.liblib.art/a.m3u8' }), {
    kind: 'direct',
    url: 'https://libtv-res.liblib.art/a.mp4',
  });
  assert.deepEqual(selectDownloadStrategy({ directUrl: null, hlsUrl: 'https://libtv-res.liblib.art/a.m3u8' }), {
    kind: 'hls',
    url: 'https://libtv-res.liblib.art/a.m3u8',
  });
  assert.throws(() => selectDownloadStrategy({ directUrl: null, hlsUrl: null }));
});
