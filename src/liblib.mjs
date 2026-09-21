const DETAIL_PATTERN = /^\/detail\/([a-f0-9]{32})\/?$/i;
const TRUSTED_MEDIA_HOSTS = new Set([
  'libtv-res.liblib.art',
  'liblibai-online.liblib.cloud',
]);

export function parseLiblibUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error('请输入完整的 Liblib 作品链接');
  }

  if (url.protocol !== 'https:' || url.hostname !== 'www.liblib.tv') {
    throw new Error('仅支持 Liblib（https://www.liblib.tv）的公开作品链接');
  }

  const match = url.pathname.match(DETAIL_PATTERN);
  if (!match) {
    throw new Error('链接必须是 Liblib detail 作品页');
  }
  return match[1].toLowerCase();
}

export function assertTrustedMediaUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error('媒体地址无效');
  }
  if (url.protocol !== 'https:' || !TRUSTED_MEDIA_HOSTS.has(url.hostname)) {
    throw new Error('媒体地址不在 Liblib 可信域名中');
  }
  return url;
}

function optionalTrustedUrl(value) {
  if (!value) return null;
  return assertTrustedMediaUrl(value).href;
}

export function extractDetail(payload) {
  if (!payload || payload.code !== 0 || !payload.data?.detail) {
    throw new Error(payload?.msg || '无法读取该 Liblib 作品');
  }
  const detail = payload.data.detail;
  return {
    title: String(detail.name || 'Liblib video'),
    description: String(detail.description || ''),
    coverUrl: optionalTrustedUrl(detail.coverUrl),
    directUrl: optionalTrustedUrl(detail.finalOutput),
    hlsUrl: optionalTrustedUrl(detail.hlsUrl || detail.masterUrl),
  };
}

export function safeFileName(value) {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/[\s_-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);
  return normalized || 'liblib-video';
}

export function selectDownloadStrategy(detail) {
  if (detail.directUrl) {
    const url = assertTrustedMediaUrl(detail.directUrl);
    return { kind: 'direct', url: url.href };
  }
  if (detail.hlsUrl) {
    const url = assertTrustedMediaUrl(detail.hlsUrl);
    return { kind: 'hls', url: url.href };
  }
  throw new Error('该公开页面没有可下载的视频资源');
}

export function detailApiUrl(projectTemplateUuid) {
  return `https://api.liblib.tv/api/community/project/template/detail?projectTemplateUuid=${projectTemplateUuid}&withRecommendList=false`;
}
