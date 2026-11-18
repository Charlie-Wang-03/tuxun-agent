// Recover only after two invalid arrow targets; never click or move the street.
export async function recoverInvalidArrows({firstInvalid, action, mode, map, width, height, topOffset, lookup}) {
  if (!firstInvalid || mode !== 'move' || action?.type !== 'move_arrow' || !map || width<=0 || height<=0) return null;
  const x=Math.round(map.x+map.width/2), y=Math.round(map.y+map.height/2);
  const nx=x/width, ny=(y-topOffset)/height;
  if (![nx,ny].every(v=>Number.isFinite(v)&&v>=0&&v<=1) || await lookup(x,y)!=='map') return null;
  return {type:'hover',x:nx,y:ny,reason:'连续两次无法确认移动箭头，转入可见地图并依据已有街景线索选点。',observation:action.observation,round:action.round};
}

// Correct only a rejected request to hover over a confirmed visible map.
// This does not click the map or choose a geographic location.
export async function recoverInvalidMapHover({action,map,width,height,topOffset,lookup}) {
  if (action?.type!=='hover' || !map || width<=0 || height<=0) return null;
  const x=Math.round(map.x+map.width/2),y=Math.round(map.y+map.height/2);
  const nx=x/width,ny=(y-topOffset)/height;
  if(![nx,ny].every(v=>Number.isFinite(v)&&v>=0&&v<=1)||await lookup(x,y)!=='map')return null;
  return {...action,x:nx,y:ny,reason:'原展开坐标不在地图上，改为悬停已确认的可见地图中心。'};
}
