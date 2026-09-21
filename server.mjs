import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

import {
  detailApiUrl,
  extractDetail,
  parseLiblibUrl,
  safeFileName,
  selectDownloadStrategy,
} from './src/liblib.mjs';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.mp4', 'video/mp4'],
]);

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_768) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new Error('请求不是有效 JSON');
  }
}

async function resolveProject(projectUrl, fetchImpl) {
  const uuid = parseLiblibUrl(projectUrl);
  const response = await fetchImpl(detailApiUrl(uuid), {
    headers: {
      accept: 'application/json',
      'user-agent': 'LiblibLocalDownloader/1.0',
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`Liblib 详情接口返回 ${response.status}`);
  return extractDetail(await response.json());
}

async function downloadDirect(url, destination, job, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { accept: 'video/mp4,video/*;q=0.9,*/*;q=0.1' },
    redirect: 'follow',
  });
  if (!response.ok || !response.body) throw new Error(`视频下载返回 ${response.status}`);

  const total = Number(response.headers.get('content-length')) || 0;
  let downloaded = 0;
  const output = createWriteStream(destination, { flags: 'wx' });
  try {
    for await (const chunk of Readable.fromWeb(response.body)) {
      downloaded += chunk.length;
      if (!output.write(chunk)) await once(output, 'drain');
      job.bytesDownloaded = downloaded;
      job.bytesTotal = total;
      job.progress = total ? Math.min(99, Math.round((downloaded / total) * 100)) : null;
    }
    output.end();
    await once(output, 'finish');
  } catch (error) {
    output.destroy();
    throw error;
  }
}

async function downloadHls(url, destination, ffmpegPath, job) {
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', url,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-progress', 'pipe:1',
      destination,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const match = chunk.match(/out_time_ms=(\d+)/);
      if (match) job.processedMicroseconds = Number(match[1]);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { errors = `${errors}${chunk}`.slice(-4000); });
    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error('未找到 FFmpeg。请先安装 FFmpeg 并确保 ffmpeg 在 PATH 中。'));
      } else {
        reject(error);
      }
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(errors.trim() || `FFmpeg 退出码 ${code}`));
    });
  });
}

async function serveFile(response, filePath, { attachment = false } = {}) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    const headers = {
      'content-type': MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
      'content-length': info.size,
      'x-content-type-options': 'nosniff',
    };
    if (attachment) {
      headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`;
    }
    response.writeHead(200, headers);
    createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, { error: '文件不存在' });
  }
}

export function createAppServer({
  fetchImpl = globalThis.fetch,
  ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg',
  outputDir = path.join(ROOT_DIR, 'downloads'),
  publicDir = path.join(ROOT_DIR, 'public'),
} = {}) {
  const jobs = new Map();

  async function startJob(job, detail, strategy) {
    try {
      await mkdir(outputDir, { recursive: true });
      job.status = 'downloading';
      if (strategy.kind === 'direct') {
        await downloadDirect(strategy.url, job.filePath, job, fetchImpl);
      } else {
        await downloadHls(strategy.url, job.filePath, ffmpegPath, job);
      }
      job.status = 'complete';
      job.progress = 100;
      job.downloadUrl = `/downloads/${encodeURIComponent(job.fileName)}`;
      job.description = detail.description;
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
    }
  }

  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    try {
      if (request.method === 'GET' && requestUrl.pathname === '/api/inspect') {
        const detail = await resolveProject(requestUrl.searchParams.get('url'), fetchImpl);
        const strategy = selectDownloadStrategy(detail);
        sendJson(response, 200, {
          title: detail.title,
          description: detail.description,
          coverUrl: detail.coverUrl,
          strategy: strategy.kind,
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/download') {
        const body = await readJson(request);
        const detail = await resolveProject(body.url, fetchImpl);
        const strategy = selectDownloadStrategy(detail);
        const jobId = randomUUID();
        const fileName = `${safeFileName(detail.title)}.mp4`;
        const job = {
          id: jobId,
          title: detail.title,
          strategy: strategy.kind,
          status: 'queued',
          progress: 0,
          bytesDownloaded: 0,
          bytesTotal: 0,
          fileName,
          filePath: path.join(outputDir, fileName),
        };
        jobs.set(jobId, job);
        void startJob(job, detail, strategy);
        sendJson(response, 202, { jobId });
        return;
      }

      const jobMatch = requestUrl.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)$/i);
      if (request.method === 'GET' && jobMatch) {
        const job = jobs.get(jobMatch[1]);
        if (!job) return sendJson(response, 404, { error: '任务不存在' });
        const { filePath, ...publicJob } = job;
        return sendJson(response, 200, publicJob);
      }

      const downloadMatch = requestUrl.pathname.match(/^\/downloads\/([^/]+)$/);
      if (request.method === 'GET' && downloadMatch) {
        const fileName = path.basename(decodeURIComponent(downloadMatch[1]));
        return serveFile(response, path.join(outputDir, fileName), { attachment: true });
      }

      if (request.method === 'GET') {
        const relative = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.slice(1);
        const filePath = path.resolve(publicDir, relative);
        if (filePath === publicDir || !filePath.startsWith(`${path.resolve(publicDir)}${path.sep}`)) {
          return sendJson(response, 403, { error: '路径不允许' });
        }
        return serveFile(response, filePath);
      }

      sendJson(response, 404, { error: '接口不存在' });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  await mkdir(path.join(ROOT_DIR, 'downloads'), { recursive: true });
  const server = createAppServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`Liblib downloader: http://127.0.0.1:${port}`);
  });
}
