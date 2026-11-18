export const DEFAULTS = Object.freeze({ roundSeconds: 300, totalSeconds: 1800, maxActions: 35, rounds: 5 });

export function validateAction(a, mode = 'fixed') {
  if (!a || typeof a !== 'object' || !['hover', 'map_control', 'map_scroll', 'map_select', 'select_and_review', 'click', 'drag', 'scroll', 'move_arrow', 'move_road', 'return_to_street', 'finish', 'stop'].includes(a.type)) throw Error('未知动作');
  if (mode === 'fixed-view' && a.type === 'drag') throw Error('固定视角模式不允许拖动街景');
  if (['move_arrow', 'move_road'].includes(a.type) && mode !== 'move') throw Error('固定模式不允许移步换景');
  const coordinate = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  if (['hover', 'map_control', 'map_scroll', 'map_select', 'select_and_review', 'click', 'drag', 'scroll', 'move_arrow', 'move_road'].includes(a.type) && (!coordinate(a.x) || !coordinate(a.y))) throw Error('坐标无效');
  if (a.type === 'drag' && (!coordinate(a.endX) || !coordinate(a.endY))) throw Error('拖动坐标无效');
  if (['scroll','map_scroll'].includes(a.type) && (!Number.isFinite(a.delta) || a.delta === 0)) throw Error('滚动量无效');
  if (typeof a.reason !== 'string' || a.reason.length > 2000) throw Error('说明无效');
  return a;
}

export function isAllowedTarget(type, kind, mode = 'fixed') {
  if (['move_arrow','move_road'].includes(type) && mode !== 'move') return false;
  if (mode === 'fixed-view' && (type === 'drag' || (type === 'scroll' && kind !== 'map'))) return false;
  const permitted = { hover: ['map', 'map_control'], map_control: ['map_control'], map_scroll: ['map'], map_select: ['map'], select_and_review: ['map'], click: ['map', 'confirm'], scroll: ['map', 'panorama','panorama_arrow'], drag: ['panorama','panorama_arrow'], move_arrow:['panorama_arrow'], move_road:['panorama'] };
  return permitted[type]?.includes(kind) ?? false;
}

export function dragPoints(x, y, endX, endY, steps = 8) {
  return Array.from({ length: steps }, (_, i) => ({ x: Math.round(x + (endX - x) * (i + 1) / steps), y: Math.round(y + (endY - y) * (i + 1) / steps) }));
}

export function scrollPixels(delta) {
  if (!Number.isFinite(delta) || delta === 0) throw Error('滚动量无效');
  return Math.sign(delta) * Math.min(600, Math.max(120, Math.abs(delta)));
}

export function allowedPage(url, title) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'tuxun.fun' && !u.username && !u.password && !u.port && /^\/challenge\/[0-9a-f-]{36}$/i.test(u.pathname) && title === '题库经典五题 - 图寻 - 探索世界';
  } catch { return false; }
}

export function checkLimits({ start, roundStart, actions, rounds }, now, limits = DEFAULTS) {
  if (now - start >= limits.totalSeconds * 1000) return '单局时间上限';
  if (now - roundStart >= limits.roundSeconds * 1000) return '单题时间上限';
  if (actions >= limits.maxActions) return '单题操作上限';
  if (rounds >= limits.rounds) return '达到题数上限';
  return null;
}
