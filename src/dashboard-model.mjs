import {message} from './dashboard-i18n.mjs';
import {emptySummary, updateSummary, phaseLabels} from './dashboard-summary.mjs';
export {parseEvents as parseReplay, summarizeEvents} from './review-data.mjs';

export const modeNames = {fixed:'固定', move:'移动', 'fixed-view':'固定视角'};
export const actionNames = {hover:'展开地图', map_control:'调整地图控件', map_scroll:'缩放地图', map_select:'地图选点', select_and_review:'选点并请求核对', click:'点击', drag:'转动街景', scroll:'缩放画面', move_arrow:'点击移动箭头', move_road:'点击道路', return_to_street:'返回观察街景', stop:'停止', finish:'结束'};
const keyLabels = {decision:'观察与计划', action_executed:'执行结果', selection_audit:'图钉核对', blind_audit:'独立国家核对', forced_mode:'进入兜底', forced_recovery:'兜底恢复', forced_selection_attempt:'兜底选点', forced_submit_attempt:'兜底提交', forced_submitted:'兜底已提交', submit_current:'提交选点', approximate_submit_attempt:'范围级提交', result:'本题结果', model_failed:'模型调用失败', rejected_decision:'动作已拦截', movement_unconfirmed:'移动未确认', movement_recovery:'移动恢复', stopped:'运行结束', restart_verified:'新局开始'};
export const eventTitle = (event, t=message) => t(keyLabels[event.kind] || phaseLabels[event.kind] || event.kind || '未知事件');
export const isKeyEvent = event => Object.hasOwn(keyLabels, event.kind);
export const eventTone = event => ['model_failed','rejected_decision'].includes(event?.kind) ? 'danger' : event?.kind?.startsWith('forced') || ['movement_unconfirmed','approximate_submit_attempt'].includes(event?.kind) ? 'warning' : 'neutral';

export function eventDetail(event, t=message) {
  if (!event) return t('尚无执行结果');
  const a = event.action || {};
  if (event.kind === 'decision') return [a.observation, t(actionNames[a.type] || a.type), a.reason].filter(Boolean).join(' · ');
  if (event.kind === 'action_executed') return t`${t(actionNames[event.type] || event.type) || t('动作')}已执行${event.target === 'confirm' ? t('；提交后结果以网站记录为准') : ''}`;
  if (event.kind === 'marker_check') return event.ok ? t('可见图钉位于点击位置附近，定位仍待验证') : t('图钉位置未确认，需要重新选点');
  if (event.kind === 'result') return t`得分 ${Number.isFinite(event.points) ? event.points + '/5000' : t('未记录')} · 距离 ${event.distance || t('未记录')}${event.forced ? t(' · 兜底：') + (event.forced_detail?.trigger || t('原因未记录')) : ''}`;
  if (event.kind === 'selection_audit') return `${({match:t('与目标描述一致'), mismatch:t('与目标描述不一致'), uncertain:t('不确定')})[event.verdict] || t('未知')} · ${event.reason || t('原因未记录')}`;
  return event.reason || event.trigger || event.label || eventTitle(event,t);
}

export function parseReplayMetadata(text) {
  const m = JSON.parse(text);
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.schema_version !== 1 || !['real','simulated'].includes(m.source) || !['redacted','none','unknown'].includes(m.editing)) throw Error('回放说明格式无效');
  if (m.recorded_at != null && (typeof m.recorded_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(m.recorded_at) || !Number.isFinite(Date.parse(m.recorded_at)))) throw Error('回放说明的录制时间无效');
  return m;
}

export function budgetValues(snapshot, now = Date.now()) {
  const state = snapshot?.summary?.state, limits = snapshot?.summary?.started?.limits;
  if (!snapshot?.running || !state || ![state.roundLimit,state.roundStart,state.start,state.actionLimit,state.actions,limits?.totalSeconds].every(Number.isFinite)) return null;
  return {round:Math.max(0, Math.ceil(state.roundLimit - (now-state.roundStart)/1000)), game:Math.max(0, Math.ceil(limits.totalSeconds - (now-state.start)/1000)), actions:Math.max(0,state.actionLimit-state.actions)};
}
export const clockText = seconds => `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
export const durationText = (seconds,t=message) => seconds % 60 === 0 ? t`${seconds/60} 分钟` : t`${seconds} 秒`;
export const tokenText = (summary,t=message) => summary.legacy && summary.structured ? t('口径混合，不合计') : summary.tokenCalls ? `${summary.tokens.toLocaleString('zh-CN')}${summary.missingCalls ? t('（部分未知）') : ''}` : t('未记录');

// Context is inferred only from recorded events. No screenshot is carried across rounds.
export function indexReplay(events) {
  let game = 1, round = null;
  return events.map((event, index) => {
    if (event.kind === 'restart_verified') {game = event.game || event.to || game; round = 1;}
    else if (Number.isSafeInteger(event.game) && event.game > 0 && event.game !== game) {game = event.game; round = null;}
    if (event.kind === 'next_round_verified') round = event.to;
    if (Number.isInteger(event.round) && event.round >= 1 && event.round <= 5) round = event.round;
    return {event, index, game, round};
  });
}

export function replayAt(indexed, position) {
  const summary = emptySummary();
  let screenshot = null, context = '', last = null;
  for (const row of indexed.slice(0, position)) {
    const key = `${row.game}:${row.round}`;
    if (key !== context) {screenshot = null; context = key;}
    updateSummary(summary, {...row.event, game:row.game, ...(row.round ? {round:row.round} : {})});
    if (typeof row.event.screenshot === 'string' && row.event.screenshot) screenshot = {name:row.event.screenshot, index:row.index, kind:row.event.kind};
    last = row;
  }
  return {summary, screenshot, last};
}

const copyReplayState = state => ({...state, summary:{...state.summary,
  state:state.summary.state?{...state.summary.state}:null,
  scores:Object.fromEntries(Object.entries(state.summary.scores).map(([game,rounds])=>[game,{...rounds}])),
  pendingCalls:[...state.summary.pendingCalls]}});
function advanceReplay(state,row) {
  const context=`${row.game}:${row.round}`;
  if(context!==state.context){state.screenshot=null;state.context=context;}
  updateSummary(state.summary,{...row.event,game:row.game,...(row.round?{round:row.round}:{})});
  if(typeof row.event.screenshot==='string'&&row.event.screenshot)state.screenshot={name:row.event.screenshot,index:row.index,kind:row.event.kind};
  state.last=row;
}

// One load-time pass; at most 64 checkpoints plus the initial state. Playback reduces only
// new events, while random seeks replay at most one checkpoint interval.
export function createReplayReader(rows) {
  const stride=Math.max(256,Math.ceil(rows.length/64)), checkpoints=[];
  let built={summary:emptySummary(),screenshot:null,last:null,context:''};
  checkpoints.push(copyReplayState(built));
  const starts=new Map(),games=new Map(),timelines=new Map();
  for(let i=0;i<rows.length;i++) {
    const row=rows[i];advanceReplay(built,row);
    if((i+1)%stride===0)checkpoints.push(copyReplayState(built));
    if(row.round&&!starts.has(`${row.game}:${row.round}`))starts.set(`${row.game}:${row.round}`,row);
    if(row.round&&!games.has(row.game))games.set(row.game,row);
    if(isKeyEvent(row.event))for(const round of row.round?[row.round]:[1,2,3,4,5]){
      const key=`${row.game}:${round}`;
      if(!timelines.has(key))timelines.set(key,[]);
      timelines.get(key).push(row);
    }
  }
  let position=0,current=copyReplayState(checkpoints[0]);
  const clamp=value=>Math.max(0,Math.min(rows.length,Math.trunc(Number(value)||0)));
  const lines=new Map();
  return {
    at(value) {
      const target=clamp(value),base=Math.floor(target/stride)*stride;
      if(target<position||base>position){current=copyReplayState(checkpoints[base/stride]);position=base;}
      while(position<target)advanceReplay(current,rows[position++]);
      const result=copyReplayState(current);
      return {summary:result.summary,screenshot:result.screenshot,last:result.last};
    },
    roundStart:(game,round)=>starts.get(`${game}:${round}`),
    gameStart:game=>games.get(game),
    timeline(game,round,value) {
      const all=timelines.get(`${game}:${round}`)||[],target=clamp(value)-1;
      let lo=0,hi=all.length;
      while(lo<hi){const mid=(lo+hi)>>>1;if(all[mid].index<target)lo=mid+1;else hi=mid;}
      const start=Math.max(0,Math.min(Math.floor(Math.max(0,lo-60)/60)*60,all.length-120));
      return {rows:all.slice(start,start+120),total:all.length};
    },
    log(value) {
      const end=clamp(value),start=Math.max(0,end-120),display=[];let shortened=false;
      for(let i=start;i<end;i++) {
        if(!lines.has(i)) {
          const raw=JSON.stringify(rows[i].event),cut=raw.length>4000;
          const limit=cut&&/[\uD800-\uDBFF]/.test(raw[3999])?3999:4000;
          lines.set(i,{text:cut?raw.slice(0,limit)+'…':raw,shortened:cut});
          if(lines.size>240)lines.delete(lines.keys().next().value);
        }
        const line=lines.get(i);display.push(line.text);shortened||=line.shortened;
      }
      return {text:display.join('\n'),start,end,shortened};
    }
  };
}
