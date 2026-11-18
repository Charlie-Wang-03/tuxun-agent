import {CDP} from './cdp.mjs';
import {allowedPage} from './policy.mjs';

// Only production defaults target the dedicated browser and its recognised game page.
// Parameters make the same capture path testable against an isolated local fixture.
export async function captureFrame({debugUrl = 'http://127.0.0.1:19365', isAllowed = allowedPage, fetchTargets = fetch, connect = CDP.connect} = {}) {
  const response = await fetchTargets(`${debugUrl}/json/list`, {signal:AbortSignal.timeout(1000)});
  if (!response.ok) throw Error('无法读取专用浏览器页面');
  const pages = (await response.json()).filter(t => t.type === 'page');
  if (pages.length !== 1 || !isAllowed(pages[0].url, pages[0].title)) throw Error('等待专用 Chrome 中的题库经典五题页面');
  const cdp = await connect(pages[0].webSocketDebuggerUrl);
  try {
    const shot = await cdp.call('Page.captureScreenshot', {format:'jpeg', quality:70, captureBeyondViewport:false}, 3000);
    return Buffer.from(shot.data, 'base64');
  } finally { cdp.close(); }
}
