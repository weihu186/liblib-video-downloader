import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAppServer } from '../server.mjs';

const PROJECT_URL = 'https://www.liblib.tv/detail/31b600ea119b48e0bf69ca0672d18856';

function fakeFetch(url) {
  if (String(url).startsWith('https://api.liblib.tv/')) {
    return Promise.resolve(Response.json({
      code: 0,
      data: {
        detail: {
          name: '测试短片',
          description: '公开作品',
          coverUrl: 'https://liblibai-online.liblib.cloud/cover.png',
          finalOutput: 'https://libtv-res.liblib.art/video.mp4',
        },
      },
    }));
  }
  if (String(url) === 'https://libtv-res.liblib.art/video.mp4') {
    return Promise.resolve(new Response(new Uint8Array([0, 1, 2, 3]), {
      headers: { 'content-length': '4', 'content-type': 'video/mp4' },
    }));
  }
  return Promise.resolve(new Response('not found', { status: 404 }));
}

async function withServer(options, run) {
  const server = createAppServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('inspect rejects an unsupported URL', async () => {
  await withServer({ fetchImpl: fakeFetch }, async (base) => {
    const response = await fetch(`${base}/api/inspect?url=${encodeURIComponent('https://example.com/video')}`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Liblib/);
  });
});

test('inspect returns normalized public detail and strategy', async () => {
  await withServer({ fetchImpl: fakeFetch }, async (base) => {
    const response = await fetch(`${base}/api/inspect?url=${encodeURIComponent(PROJECT_URL)}`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.title, '测试短片');
    assert.equal(payload.strategy, 'direct');
    assert.equal(payload.mediaUrl, undefined);
  });
});

test('download job writes the public MP4 and reports completion', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'liblib-downloader-'));
  await withServer({ fetchImpl: fakeFetch, outputDir }, async (base) => {
    const created = await fetch(`${base}/api/download`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: PROJECT_URL }),
    });
    assert.equal(created.status, 202);
    const { jobId } = await created.json();

    let job;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await fetch(`${base}/api/jobs/${jobId}`);
      job = await response.json();
      if (job.status === 'complete' || job.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(job.status, 'complete');
    assert.equal(job.progress, 100);
    assert.deepEqual([...await readFile(path.join(outputDir, job.fileName))], [0, 1, 2, 3]);
  });
});
