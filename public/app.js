const form = document.querySelector('#project-form');
const urlInput = document.querySelector('#project-url');
const inspectButton = document.querySelector('#inspect-button');
const preview = document.querySelector('#preview');
const cover = document.querySelector('#cover');
const title = document.querySelector('#title');
const description = document.querySelector('#description');
const strategy = document.querySelector('#strategy');
const status = document.querySelector('#status');
const downloadButton = document.querySelector('#download-button');
const progress = document.querySelector('#progress');
const progressLabel = document.querySelector('#progress-label');
const progressValue = document.querySelector('#progress-value');
const progressBar = document.querySelector('#progress-bar');
const resultLink = document.querySelector('#result-link');

let currentUrl = '';
let pollTimer = null;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function resetDownload() {
  if (pollTimer) clearTimeout(pollTimer);
  progress.hidden = true;
  progress.classList.remove('indeterminate');
  progressBar.style.width = '0%';
  resultLink.hidden = true;
  resultLink.removeAttribute('href');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  resetDownload();
  preview.hidden = true;
  inspectButton.disabled = true;
  setStatus('正在读取 Liblib 公开作品信息…');
  try {
    currentUrl = urlInput.value.trim();
    const data = await requestJson(`/api/inspect?url=${encodeURIComponent(currentUrl)}`);
    cover.src = data.coverUrl || '';
    cover.hidden = !data.coverUrl;
    title.textContent = data.title;
    description.textContent = data.description || '该作品没有填写简介。';
    strategy.textContent = data.strategy === 'direct' ? 'DIRECT MP4' : 'HLS · FFMPEG';
    preview.hidden = false;
    setStatus('解析完成。确认作品后即可保存到本地。');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    inspectButton.disabled = false;
  }
});

downloadButton.addEventListener('click', async () => {
  resetDownload();
  downloadButton.disabled = true;
  progress.hidden = false;
  progress.classList.add('indeterminate');
  progressLabel.textContent = '正在创建下载任务…';
  progressValue.textContent = '—';
  try {
    const { jobId } = await requestJson('/api/download', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: currentUrl }),
    });
    await pollJob(jobId);
  } catch (error) {
    progress.hidden = true;
    setStatus(error.message, true);
    downloadButton.disabled = false;
  }
});

async function pollJob(jobId) {
  try {
    const job = await requestJson(`/api/jobs/${jobId}`);
    if (typeof job.progress === 'number') {
      progress.classList.remove('indeterminate');
      progressBar.style.width = `${job.progress}%`;
      progressValue.textContent = `${job.progress}%`;
    }
    progressLabel.textContent = job.strategy === 'hls' ? 'FFmpeg 正在合并 HLS…' : '正在保存 MP4…';

    if (job.status === 'failed') throw new Error(job.error || '下载失败');
    if (job.status === 'complete') {
      progress.classList.remove('indeterminate');
      progressBar.style.width = '100%';
      progressValue.textContent = '100%';
      progressLabel.textContent = '处理完成';
      resultLink.href = job.downloadUrl;
      resultLink.download = job.fileName;
      resultLink.hidden = false;
      downloadButton.disabled = false;
      setStatus(`已完成：${job.fileName}`);
      return;
    }
    pollTimer = setTimeout(() => pollJob(jobId), 700);
  } catch (error) {
    progress.hidden = true;
    setStatus(error.message, true);
    downloadButton.disabled = false;
  }
}
