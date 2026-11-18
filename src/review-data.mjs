// Pure event parsing and summaries shared by the CLI and browser.
export function parseEvents(text) {
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/), events=[];
  let truncated=false;
  for(let i=0;i<lines.length;i++) {
    if(!lines[i].trim())continue;
    let e;
    try {e=JSON.parse(lines[i]);}
    catch(e){if(i===lines.length-1 && !text.endsWith('\n')){truncated=true;break;}throw Error(`事件日志第 ${i+1} 行无效：${e.message}`);}
    if(!e || typeof e!=='object' || Array.isArray(e))throw Error(`事件日志第 ${i+1} 行无效：不是事件对象`);
    events.push(e);
  }
  if(!events.length)throw Error('事件日志没有可读取的事件');
  return {events,truncated};
}

const finite = n => typeof n==='number' && Number.isFinite(n);
const when = value => {const t=Date.parse(value);return Number.isFinite(t)?t:null};
const seconds = (a,b) => a!==null && b!==null && b>=a ? Math.round((b-a)/100)/10 : null;

export function hasStructuredUsage(u) {
  return Boolean(u && [u.input_tokens,u.cached_input_tokens,u.output_tokens].every(v=>finite(v)&&v>=0) && u.cached_input_tokens<=u.input_tokens);
}

// Shared pairing for live summaries and offline review; names can repeat across rounds.
export function updatePendingCalls(pending, event, game, round) {
  if(event.kind==='model_start') {pending.push({game,round:round ?? null,label:event.label});return 1;}
  if(event.kind!=='model_finished' && event.kind!=='model_failed')return 0;
  const index=pending.findIndex(p=>p.game===game && p.round===(round ?? null) && p.label===event.label);
  if(index<0)return 0;
  pending.splice(index,1);return -1;
}

export function summarizeEvents(events,{truncated=false}={}) {
  const started=events.find(e=>e.kind==='started'),stopped=events.findLast(e=>e.kind==='stopped');
  const games=new Map();
  const roundsFor = game => {if(!games.has(game))games.set(game,Array.from({length:5},(_,i)=>({round:i+1,start:null,result:null,modelCalls:0,modelMs:0,modelDurationKnown:true,failed:0,tokenTotal:0,tokenKnownCalls:0,missingTokens:0,structuredCalls:0,legacyCalls:0,issues:[]})));return games.get(game)};
  const rounds=roundsFor(1);
  const usage={input:0,cached:0,output:0,structuredCalls:0,legacyCalls:0,missingCalls:0};
  let current=null,currentGame=1,modelCalls=0,failed=0,unknownRoundCalls=0,knownTokens=0,knownTokenCalls=0,modelMs=0,missingDurationCalls=0;const issues=[],pending=[];
  for(const e of events) {
    if(Number.isSafeInteger(e.game)&&e.game>0&&e.game!==currentGame){currentGame=e.game;current=null;}
    const currentRounds=roundsFor(currentGame);
    const explicit=Number.isInteger(e.round)&&e.round>=1&&e.round<=5?e.round:null;
    if(e.kind==='state' && explicit) {current=explicit;const r=currentRounds[current-1];if(r.start===null)r.start=when(e.time);}
    const n=explicit ?? current, r=n?currentRounds[n-1]:null;
    if(e.kind==='result' && r)r.result=e;
    updatePendingCalls(pending,e,currentGame,n);
    if(e.kind==='model_finished'||e.kind==='model_failed') {
      modelCalls++;if(e.kind==='model_failed')failed++;
      if(r){r.modelCalls++;if(e.kind==='model_failed')r.failed++;}else unknownRoundCalls++;
      if(finite(e.elapsed_ms)&&e.elapsed_ms>=0){modelMs+=e.elapsed_ms;if(r)r.modelMs+=e.elapsed_ms;}else{missingDurationCalls++;if(r)r.modelDurationKnown=false;}
      if(finite(e.tokens)&&e.tokens>=0){knownTokens+=e.tokens;knownTokenCalls++;if(r){r.tokenTotal+=e.tokens;r.tokenKnownCalls++;}}else{usage.missingCalls++;if(r)r.missingTokens++;}
      const u=e.usage;
      if(hasStructuredUsage(u)){usage.structuredCalls++;if(r)r.structuredCalls++;usage.input+=u.input_tokens;usage.cached+=u.cached_input_tokens;usage.output+=u.output_tokens;}
      else if(finite(e.tokens)&&e.tokens>=0){usage.legacyCalls++;if(r)r.legacyCalls++;}
    }
    if(['rejected_decision','model_failed','forced_recovery'].includes(e.kind)) {
      const issue={game:currentGame,round:n,kind:e.kind,reason:typeof e.reason==='string'?e.reason:'未知'};issues.push(issue);if(r)r.issues.push(issue);
    }
  }
  for(const p of pending){modelCalls++;usage.missingCalls++;missingDurationCalls++;const r=p.round?roundsFor(p.game)[p.round-1]:null;if(r){r.modelCalls++;r.missingTokens++;r.modelDurationKnown=false;}else unknownRoundCalls++;issues.push({game:p.game,round:p.round,kind:'model_unfinished',reason:`${p.label ?? '模型调用'}未记录结束`});}
  for(const group of games.values())for(const r of group)r.elapsed=r.result?seconds(r.start,when(r.result.time)):null;
  const resultCount=[...games.values()].flat().filter(r=>r.result).length;
  const startTime=when(started?.time), endTime=when(stopped?.time);
  return {mode:started?.mode ?? null,stopped:stopped?.reason ?? null,elapsed:seconds(startTime,endTime),resultCount,rounds,games,plannedGames:started?.limits?.games ?? 1,modelCalls,failed,unknownRoundCalls,modelMs,missingDurationCalls,knownTokens,knownTokenCalls,usage,issues,truncated};
}
