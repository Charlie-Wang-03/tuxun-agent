// Expand only an already-visible map, once; never repeat an unconfirmed click.
export async function expandVisibleMap({getMap,getButton,click,wait,onAttempt,viewportWidth}) {
  const before=await getMap();
  if(!before || before.width<400 || before.height<250 || before.width>=Math.min(700,viewportWidth*.4)) return {attempted:false};
  const button=await getButton(); if(!button)return {attempted:false};
  await onAttempt(); await click(button);
  for(let i=0;i<12;i++) {await wait();const after=await getMap();if(after && after.width>before.width+20 && after.height>before.height+10)return {attempted:true,before,after};}
  throw Error('地图窗口扩大后未能确认布局变化，已停止且不会重复点击');
}
