import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('frontend exposes the inspect, preview, progress, and download flow', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  for (const id of ['project-form', 'project-url', 'inspect-button', 'preview', 'download-button', 'progress', 'result-link']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /aria-live=["']polite["']/);
  assert.match(script, /\/api\/inspect/);
  assert.match(script, /\/api\/download/);
  assert.match(script, /\/api\/jobs\//);
});
