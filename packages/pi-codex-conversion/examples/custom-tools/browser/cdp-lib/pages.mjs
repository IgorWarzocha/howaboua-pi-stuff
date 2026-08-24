import { getDisplayPrefixLength, sleep } from './runtime.mjs';

async function getPages(cdp) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  return targetInfos.filter(t => t.type === 'page' && !t.url.startsWith('chrome://'));
}

async function waitForOpenedTarget(cdp, targetId, requestedUrl, timeout = 5000) {
  if (requestedUrl === 'about:blank') return { targetId, title: requestedUrl, url: requestedUrl };
  const deadline = Date.now() + timeout;
  let targetInfo = { targetId, title: requestedUrl, url: requestedUrl };
  while (Date.now() < deadline) {
    ({ targetInfo } = await cdp.send('Target.getTargetInfo', { targetId }));
    if (targetInfo.url && targetInfo.url !== 'about:blank') return targetInfo;
    await sleep(100);
  }
  throw new Error(`New tab did not begin navigating to ${requestedUrl}`);
}

function formatPageList(pages) {
  const prefixLen = getDisplayPrefixLength(pages.map(p => p.targetId));
  return pages.map(p => {
    const id = p.targetId.slice(0, prefixLen).padEnd(prefixLen);
    const title = p.title.substring(0, 54).padEnd(54);
    return `${id}  ${title}  ${p.url}`;
  }).join('\n');
}

function formatPagesJson(pages) {
  const prefixLen = getDisplayPrefixLength(pages.map(p => p.targetId));
  return JSON.stringify(pages.map(p => ({
    ref_id: p.targetId.slice(0, prefixLen),
    title: p.title,
    url: p.url,
  })));
}

async function getTargetRef(cdp, targetId) {
  const pages = await getPages(cdp);
  const prefixLen = getDisplayPrefixLength(pages.map(page => page.targetId));
  return targetId.slice(0, prefixLen);
}

export { formatPageList, formatPagesJson, getPages, getTargetRef, waitForOpenedTarget };
