// Inspect only the visible element at a screen position; do not access game data.
import { isAllowedTarget } from './policy.mjs';
import { PageStateError } from './page-state.mjs';

async function readTarget(cdp, params) {
  try {
    const result=await cdp.call('Runtime.evaluate',params);
    if(result.exceptionDetails||!result.result)throw Error('可见控件读取失败');
    return result;
  } catch(cause) { throw new PageStateError('无法读取可见操作目标',cause); }
}

export async function targetKind(cdp, x, y) {
  const expression = `(() => { const stack=document.elementsFromPoint(${Math.round(x)},${Math.round(y)}), e=stack[0]; if(!e)return 'unknown'; for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);if(s.visibility!=='visible'||s.display==='none'||Number(s.opacity)===0)return 'unknown';} if(e.closest('[class*="mapControl"], [class*="zoomControl"]') && e.closest('button'))return e.closest('button').disabled?'unknown':'map_control'; const confirm=e.closest('[class*="mapConfirm"] button'); if(confirm)return confirm.innerText.trim()==='确定选择' && !confirm.disabled ? 'confirm' : 'unknown'; if(e.closest('.maplibregl-map'))return 'map'; if(e.matches('path[role="button"]')&&stack.some(n=>n.matches?.('.widget-scene')))return 'panorama_arrow'; if(e.closest('.widget-scene'))return 'panorama'; return 'unknown'; })()`;
  const r = await readTarget(cdp, { expression, returnByValue: true });
  return r.result.value;
}

// UI labels establish semantics; button position never does.
export function mapControlName(group, label) {
  const names = {map: ['扩大地图窗口', '缩小地图窗口', '固定或取消固定地图'], zoom: ['放大地图内容', '缩小地图内容']};
  if (group === 'zoom' && ['+', '＋', '放大'].includes(label)) return names.zoom[0];
  if (group === 'zoom' && ['-', '−', '缩小'].includes(label)) return names.zoom[1];
  return names[group]?.includes(label) ? label : null;
}

function mapControls() {
  return [...document.querySelectorAll('[class*="mapControl"] button, [class*="zoomControl"] button')].flatMap(button => {
    const group = button.closest('[class*="mapControl"], [class*="zoomControl"]');
    const r = button.getBoundingClientRect(), x = r.x+r.width/2, y = r.y+r.height/2;
    if (button.disabled || r.width <= 0 || r.height <= 0 || getComputedStyle(button).visibility !== 'visible' || !button.contains(document.elementFromPoint(x,y))) return [];
    for(let n=button;n;n=n.parentElement)if(Number(getComputedStyle(n).opacity)===0)return [];
    const labels = [...new Set([button.innerText, button.getAttribute('aria-label'), button.getAttribute('title')].map(s => s?.trim()).filter(Boolean))];
    return [{x,y,left:r.left,top:r.top,right:r.right,bottom:r.bottom,group:group.className.includes('zoomControl')?'zoom':'map',labels}];
  });
}

async function namedControls(cdp) {
  const r = await readTarget(cdp, {expression:`(${mapControls.toString()})()`, returnByValue:true});
  if (!Array.isArray(r.result?.value)) return [];
  return r.result.value.map(control => {
    const names = [...new Set(control.labels.map(label => mapControlName(control.group,label)).filter(Boolean))];
    return {...control,name:names.length===1?names[0]:null};
  });
}

export async function mapControlAt(cdp, x, y) {
  const controls = (await namedControls(cdp)).filter(c => x>=c.left && x<c.right && y>=c.top && y<c.bottom);
  // Verify the exact pointer target too; coordinates from a stale frame are unsafe.
  if (controls.length !== 1 || await targetKind(cdp,x,y) !== 'map_control') return null;
  return controls[0].name;
}

export async function visibleMapExpandButton(cdp) {
  const controls = (await namedControls(cdp)).filter(c => c.name === '扩大地图窗口');
  return controls.length===1 ? {x:controls[0].x,y:controls[0].y} : null;
}

// Read only the visible map and pin rectangles, never map coordinates or game state.
export async function visibleMap(cdp) {
  const expression = `(() => {const visible=e=>{for(let n=e;n;n=n.parentElement)if(Number(getComputedStyle(n).opacity)===0)return false;const r=e.getBoundingClientRect();return r.width>=80&&r.height>=80&&getComputedStyle(e).visibility==='visible'&&getComputedStyle(e).opacity!=='0'&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};const maps=[...document.querySelectorAll('.maplibregl-map')].filter(visible);if(maps.length!==1)return null;const m=maps[0],r=m.getBoundingClientRect();const pins=[...m.querySelectorAll('.maplibregl-marker')].filter(e=>{for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);if(s.visibility!=='visible'||s.display==='none'||Number(s.opacity)===0)return false;}return true;}).map(e=>e.getBoundingClientRect()).filter(q=>q.width>0&&q.height>0&&q.left>=Math.max(0,r.left)&&q.top>=Math.max(0,r.top)&&q.right<=Math.min(innerWidth,r.right)&&q.bottom<=Math.min(innerHeight,r.bottom)).map(q=>({x:q.x+q.width/2,y:q.y+q.height}));return {x:r.x,y:r.y,width:r.width,height:r.height,pins};})()`;
  const r = await readTarget(cdp, { expression, returnByValue: true });
  return r.result.value;
}

export async function resolveActionTarget(cdp, action, width, height, topOffset, lookup = targetKind, mode = 'fixed') {
  const x = Math.round(action.x * width), y = topOffset + Math.round(action.y * height);
  const kind = await lookup(cdp, x, y);
  if (!isAllowedTarget(action.type, kind, mode)) throw Error(`动作目标不是允许的可见控件（${action.type}: ${kind}）`);
  if (action.type !== 'drag') return { x, y, kind };
  const endX = Math.round(action.endX * width), endY = topOffset + Math.round(action.endY * height);
  if (!['panorama','panorama_arrow'].includes(await lookup(cdp, endX, endY))) throw Error('街景拖动终点不在街景区域');
  return { x, y, kind, endX, endY };
}

// Check geometry and accessibility role only; never read arrow labels or panorama IDs.
export async function hasVisibleStreetArrows(cdp) {
  const expression = `(() => [...document.querySelectorAll('path[role="button"]')].some(e=>{const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(r.width<8||r.height<5||x<innerWidth*.25||x>innerWidth*.75||y<innerHeight*.45||y>=innerHeight||getComputedStyle(e).visibility!=='visible')return false;const stack=document.elementsFromPoint(x,y);return stack.includes(e)&&stack.some(n=>n.matches?.('.widget-scene'))}))()`;
  const r=await readTarget(cdp,{expression,returnByValue:true});return r.result.value===true;
}

export async function resolveMapSelection(cdp, action, mapRect, lookup = targetKind) {
  if (!mapRect || !Number.isFinite(mapRect.x) || !Number.isFinite(mapRect.y) || mapRect.width < 80 || mapRect.height < 80) throw Error('地图局部画面不可用');
  const x=Math.round(mapRect.x + action.x * mapRect.width), y=Math.round(mapRect.y + action.y * mapRect.height);
  const kind=await lookup(cdp,x,y);
  if(kind!=='map')throw Error(`局部选点目标不是地图（${kind}）`);
  return {x,y,kind};
}

export async function visibleButton(cdp, label, selector = 'button') {
  const expression = `(() => {const b=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>{for(let n=e;n;n=n.parentElement)if(Number(getComputedStyle(n).opacity)===0)return false;return e.innerText.trim()===${JSON.stringify(label)} && !e.disabled;}).map(e=>({e,r:e.getBoundingClientRect()})).filter(({e,r})=>r.width>0&&r.height>0&&getComputedStyle(e).visibility==='visible'&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)));return b.length===1?{x:b[0].r.x+b[0].r.width/2,y:b[0].r.y+b[0].r.height/2}:null})()`;
  const r = await readTarget(cdp, { expression, returnByValue: true });
  return r.result.value;
}
