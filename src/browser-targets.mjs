import {allowedPage} from './policy.mjs';

// Reading the local endpoint must not stall stop handling indefinitely.
export async function readBrowserTargets(port, {fetchTargets=fetch, timeoutMs=3000}={}) {
  const response=await fetchTargets(`http://127.0.0.1:${port}/json/list`, {signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok)throw Error('无法读取专用浏览器页面');
  const targets=await response.json();
  if(!Array.isArray(targets))throw Error('浏览器页面列表无效');
  return targets;
}

export function singleGamePage(targets, id) {
  const pages=targets.filter(t=>t.type==='page');
  const page=pages[0];
  return pages.length===1 && allowedPage(page.url,page.title) && (id===undefined || page.id===id) ? page : null;
}
