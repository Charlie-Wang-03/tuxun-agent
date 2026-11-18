export class PageStateError extends Error {
  constructor(message, cause) { super(message, {cause}); this.name = 'PageStateError'; }
}

const integer = /^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/;
function number(value, max, label) {
  if (!integer.test(value)) throw new PageStateError(`${label}格式无法确认`);
  const n = Number(value.replaceAll(',', ''));
  if (!Number.isSafeInteger(n) || n > max) throw new PageStateError(`${label}范围无法确认`);
  return n;
}

export function parseVisibleFields(snapshot) {
  if (!snapshot || snapshot.loginBlocked !== false || !Array.isArray(snapshot.fields) || snapshot.fields.some(f=>!f||!['回合','总分','距离','得分'].includes(f.label)||typeof f.value!=='string')) throw new PageStateError('无法确认题库页面状态');
  const get = (label, required = false) => {
    const found = snapshot.fields.filter(f => f.label === label);
    if (found.length > 1 || (required && found.length !== 1)) throw new PageStateError(`${label}字段缺失或不唯一`);
    if (found.length && typeof found[0].value !== 'string') throw new PageStateError(`${label}格式无法确认`);
    return found.length ? found[0].value.trim() : null;
  };
  const roundText = get('回合', true), match = /^([1-5])\s*\/\s*5$/.exec(roundText);
  if (!match) throw new PageStateError('无法确认题号');
  const round = Number(match[1]), total = get('总分');
  const score = total === null ? null : number(total, 25000, '总分');
  const distance = get('距离'), points = get('得分');
  let result = null;
  if (distance !== null || points !== null) {
    const d = /^(\S+)\s*(km|m|公里|米)$/i.exec(distance ?? '');
    const p = /^(\S+)\s*\/\s*(5000|5,000)$/.exec(points ?? '');
    if (!d || !p) throw new PageStateError('结果页数据无法确认');
    const [whole, fraction] = d[1].split('.');
    if (d[1].split('.').length > 2 || (fraction !== undefined && !/^\d+$/.test(fraction))) throw new PageStateError('距离格式无法确认');
    number(whole, 40075000, '距离');
    const numericDistance = Number(d[1].replaceAll(',', '')) * (/^(km|公里)$/i.test(d[2]) ? 1000 : 1);
    if (!Number.isFinite(numericDistance) || numericDistance > 40075000) throw new PageStateError('距离范围无法确认');
    result = {distance: `${d[1]} ${d[2]}`, points: number(p[1], 5000, '得分')};
  }
  return {round, score, result};
}

// Executed in the dedicated page. Only rendered field text and UI geometry are
// read; never framework state, input values, map coordinates or network data.
export function snapshotVisibleState() {
  const labels = ['回合', '总分', '距离', '得分'];
  const visible = e => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
    for (let n = e; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.visibility !== 'visible' || s.display === 'none' || Number(s.opacity) === 0) return false;
    }
    return true;
  };
  const allElements = [...document.body.querySelectorAll('*')], elements = allElements.filter(visible);
  // innerText can include opacity-zero descendants. Do not parse a container
  // that mixes visible text with hidden descendants; narrower fields still work.
  const mixed = new Set();
  for (const e of allElements) {
    const s=getComputedStyle(e);
    if(s.visibility==='visible'&&s.display!=='none'&&Number(s.opacity)!==0)continue;
    for(let n=e.parentElement;n&&n!==document.body;n=n.parentElement)mixed.add(n);
  }
  const text = e => mixed.has(e) ? '' : (e.innerText ?? '').trim();
  const candidates = (label, excluded = []) => {
    const found = elements.filter(e => !excluded.some(n => n.contains(e))).flatMap(e => {
      const rect=e.getBoundingClientRect();
      if(rect.left<0||rect.top<0||rect.right>innerWidth||rect.bottom>innerHeight)return [];
      const t = text(e), lines = t.split(/\r?\n/).filter(s => s.trim());
      if (lines.length > 2 || t.length > 200) return [];
      const match = new RegExp(`^${label}(?:\\s*[:：]\\s*|\\s+|(?=\\d))([\\s\\S]*)$`).exec(t);
      return match ? [{e, label, value: match[1].trim()}] : [];
    });
    return found.filter(a => !found.some(b => a !== b && a.e.contains(b.e)));
  };
  const titles = candidates('题库').map(f => f.e);
  const fields = labels.flatMap(label => {
    const paired = candidates(label, titles);
    // Keep a standalone label as an invalid field, rather than ignoring a
    // half-rendered result panel and treating it as an active round.
    const orphan = elements.filter(e => text(e).replace(/[:：]$/, '') === label && !titles.some(n => n.contains(e)) && !paired.some(f => f.e.contains(e)))
      .filter(e => ![...e.children].some(c => text(c).replace(/[:：]$/, '') === label));
    return [...paired.map(({label, value}) => ({label, value})), ...orphan.map(() => ({label, value: ''}))];
  });
  const loginLabel = /^(?:(?:请先|请|立即|尚未)?(?:登录|登入)(?:\s*[/／]\s*注册|后继续|后查看)?|验证码|账号|密码)\s*[:：]?$/;
  const loginBlocked = elements.some(e => e.matches('input[type="password"]') ||
    (e.matches('button,a,[role="button"],[role="dialog"]') && loginLabel.test(text(e))) ||
    (!titles.some(n => n.contains(e)) && loginLabel.test(text(e))));
  const protectedRects = [...titles, ...labels.flatMap(label => candidates(label, titles).map(f => f.e))].map(e => {
    const r = e.getBoundingClientRect();
    return {x:r.x, y:r.y, width:r.width, height:r.height};
  });
  return {fields, loginBlocked, titleCount:titles.length, protectedRects};
}

async function readSnapshot(cdp) {
  try {
    const r = await cdp.call('Runtime.evaluate', {expression: `(${snapshotVisibleState.toString()})()`, returnByValue: true});
    if (r.exceptionDetails) throw Error('可见字段读取失败');
    parseVisibleFields(r.result?.value);
    return r.result.value;
  } catch (cause) {
    if (cause instanceof PageStateError) throw cause;
    throw new PageStateError('无法读取可见页面状态', cause);
  }
}

export async function readVisibleGameState(cdp) {
  return parseVisibleFields(await readSnapshot(cdp));
}

export async function readGameLayout(cdp, viewport) {
  const snapshot = await readSnapshot(cdp);
  if (snapshot.titleCount !== 1 || !snapshot.protectedRects?.length) throw new PageStateError('无法确认题库信息的可见边界');
  if (![viewport.clientWidth,viewport.clientHeight].every(v=>Number.isFinite(v)&&v>=400)) throw new PageStateError('页面尺寸无法确认');
  const compassClip = {x:Math.floor(viewport.clientWidth*.42), y:0, width:Math.floor(viewport.clientWidth*.16), height:50, scale:1};
  let topOffset = 70;
  for (const rect of snapshot.protectedRects) {
    if (!['x','y','width','height'].every(k => Number.isFinite(rect[k])) || rect.width <= 0 || rect.height <= 0) throw new PageStateError('页面布局无法确认');
    if (rect.x < compassClip.x+compassClip.width && rect.x+rect.width > compassClip.x && rect.y < 50 && rect.y+rect.height > 0) throw new PageStateError('方位截图与题库信息重叠');
    topOffset = Math.max(topOffset, Math.ceil(rect.y+rect.height));
  }
  const safeHeight = Math.floor(viewport.clientHeight-topOffset-30);
  if (safeHeight < 300) throw new PageStateError('页面布局没有足够的街景截图区域');
  return {topOffset, safeHeight, compassClip};
}
