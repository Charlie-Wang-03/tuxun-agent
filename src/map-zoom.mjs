// Cursor-anchored zoom keeps the target near its current screen position.
// For a target near an edge, zoom out at the opposite side first, then re-observe.
export function planMapZoom(action, edge = .88) {
  if (action.type !== 'map_scroll' || action.delta >= 0) return { action, reframed:false };
  const nearEdge = [action.x,action.y].some(v=>v>edge||v<1-edge);
  if (!nearEdge) return { action, reframed:false };
  const opposite = v=>Math.max(.18,Math.min(.82,1-v));
  return { action:{...action,x:opposite(action.x),y:opposite(action.y),delta:360,reason:`目标接近地图边缘，先在对侧缩小以改善视野，再重新观察。原目标：${action.reason}`}, reframed:true };
}

export async function dispatchMapWheel({ move, target, wheel, wait, x, y }) {
  await move(x,y);
  await wait();
  if (!await target(x,y)) throw Error('悬停后地图布局或目标已变化，未缩放');
  await wheel(x,y);
}
