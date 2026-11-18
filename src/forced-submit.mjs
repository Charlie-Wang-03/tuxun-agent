export function shouldForceSubmit(remainingMs, actions, actionLimit) {
  return remainingMs>0 && (remainingMs<=60000 || actionLimit-actions<=3);
}
export function decisionTimeoutBeforeForce(remainingMs, maxMs=Infinity) {
  return Math.max(1,Math.min(maxMs,remainingMs-60000));
}

export function decisionBudgetHint(timeoutMs) {
  return `本次模型调用时限约 ${Math.max(0,Math.floor(timeoutMs/1000))} 秒；这是扣除提交预留并按当前阶段限制后的调用时限，不是本题或本局的剩余总时间。模型思考计入运行预算，请尽快完成本次决策。`;
}

// All functions operate only on the current visible game page. Submit at most once.
export async function forceSubmitRound({round,read,inspect,selectFallback,submit,log,remaining,wait=()=>new Promise(r=>setTimeout(r,300))}) {
  const initial=await read();
  if(initial.round!==round)throw Error('题号已变化，不能兜底提交');
  if(initial.result)return {alreadyResult:true};
  if(remaining()<=0)throw Error('时间上限');
  let view=await inspect();
  if(view.pins>1)throw Error('多个可见图钉，无法确认当前选点');
  let source='existing_pin', position=view.pin ?? null;
  if(view.pins===0){source='map_center';position=await selectFallback();}
  // Wait for the map and button; never repeat the selection click.
  for(let i=0;i<10;i++) {
    if(remaining()<=0)throw Error('时间上限');
    view=await inspect();
    if(view.pins>1)throw Error('多个可见图钉，无法确认当前选点');
    if(view.pins===1 && view.pin && view.confirm && (source==='existing_pin'||Math.hypot(view.pin.x-position.x,view.pin.y-position.y)<=48))break;
    if(i<9)await wait();
  }
  if(view.pins!==1 || !view.pin || !view.confirm || (source==='map_center'&&Math.hypot(view.pin.x-position.x,view.pin.y-position.y)>48))throw Error('兜底选点后无法确认图钉或提交按钮');
  if(source==='existing_pin')position=view.pin;
  const state=await read();if(state.round!==round || state.result)throw Error('提交前题目状态发生变化');
  if(remaining()<=0)throw Error('时间上限');
  const recheck=await inspect();
  if(recheck.pins!==1 || !recheck.pin || !view.pin || Math.hypot(recheck.pin.x-view.pin.x,recheck.pin.y-view.pin.y)>3 || !recheck.confirm)throw Error('提交前图钉或按钮发生变化');
  view=recheck;
  await log({kind:'forced_submit_attempt',round,source,position});
  if(remaining()<=0)throw Error('时间上限');
  await submit(view.confirm);
  await log({kind:'forced_submitted',round,source,position});
  return {source,position};
}
