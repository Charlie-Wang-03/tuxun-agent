export function shouldFinalize(remainingMs, roundSeconds) {
  const threshold=Math.min(120000,Math.max(30000,roundSeconds*1000*.4));
  return Number.isFinite(remainingMs) && remainingMs>0 && remainingMs<=threshold;
}
export function finalActionAllowed(action, targetKind, mapZooms) {
  if (['move_arrow','move_road','drag','return_to_street'].includes(action.type)) return false;
  if (action.type==='scroll' && targetKind!=='map') return false;
  if ((action.type==='map_scroll'||(action.type==='scroll'&&targetKind==='map')) && mapZooms>=2) return false;
  return true;
}
export function maySubmitApproximate(audit, remainingMs, roundSeconds) {
  return shouldFinalize(remainingMs,roundSeconds) && audit?.verdict==='uncertain' && audit.approximate_ok===true;
}
