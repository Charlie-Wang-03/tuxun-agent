import {hasStructuredUsage, updatePendingCalls} from './review-data.mjs';

export const phaseLabels = {
  started:'启动中', street_loading:'等待街景', model_start:'等待模型',
  model_finished:'模型已返回', model_failed:'模型调用失败', decision:'准备执行动作',
  action_executed:'已执行操作', invalid_action_recovery:'恢复地图展开',
  forced_mode:'正在兜底', forced_selection_attempt:'正在选择兜底点',
  forced_submit_attempt:'正在提交兜底点', forced_submitted:'兜底已提交，等待结果',
  selection_audit:'已完成图钉核对', result:'已记录本题结果',
  game_completed:'本局完成', restart_attempt:'正在重开', restart_verified:'已进入新局',
  next_round_verified:'已进入下一题', stopped:'已停止',
  movement_unconfirmed:'移动变化未确认', movement_recovery:'依据已有线索转入地图',
  movement_attempt:'等待移动画面', endgame_started:'正在限时收尾',
  submit_current:'正在提交选点', approximate_submit_attempt:'正在提交范围级选点',
};

export function emptySummary() {
  return {started:null, state:null, phase:null, latestAudit:null, observation:null, decision:null,
    actionResult:null, fallback:null, scores:{}, tokens:0, tokenCalls:0, missingCalls:0, legacy:false, structured:false, pendingCalls:[]};
}

function clearRound(summary) {
  for (const key of ['latestAudit','observation','decision','actionResult','fallback']) summary[key] = null;
}

export function updateSummary(summary, event) {
  if (event.kind === 'started') {
    Object.assign(summary, emptySummary());
    summary.started = event;
  }
  const game = Number.isSafeInteger(event.game) && event.game > 0 ? event.game : summary.state?.game || 1;
  const round = Number.isInteger(event.round) && event.round >= 1 && event.round <= 5 ? event.round : game===summary.state?.game ? summary.state?.round : undefined;
  if (event.kind === 'restart_verified' || event.kind === 'next_round_verified') {
    clearRound(summary);
    summary.state = event.kind === 'restart_verified'
      ? {game:event.game || event.to, round:1}
      : {game, round:event.to, score:summary.state?.score};
  } else if ((summary.state && game!==summary.state.game) || round) {
    if (game !== summary.state?.game || round !== summary.state?.round) {
      clearRound(summary);
      summary.state = {game, round};
    }
    if (event.kind === 'state') summary.state = {...event, game, round};
  }
  const label = phaseLabels[event.kind];
  if (label) summary.phase = {kind:event.kind, label:event.kind === 'model_start' ? event.label || label : label, time:event.time ?? null};
  if (event.kind === 'selection_audit') summary.latestAudit = {game, round, verdict:event.verdict, reason:event.reason};
  if (event.kind === 'decision') {
    summary.decision = event.action || null;
    if (event.action?.observation) summary.observation = event.action.observation;
    summary.actionResult = null;
    if (['map_select','select_and_review','map_scroll','map_control'].includes(event.action?.type)) summary.latestAudit = null;
  }
  if (['action_executed','rejected_decision','model_failed','movement_unconfirmed','movement_recovery','forced_submitted','marker_check'].includes(event.kind)) summary.actionResult = event;
  if (event.kind === 'forced_mode' || event.kind === 'forced_recovery') summary.fallback = event.trigger || event.reason || '原因未记录';
  if (event.kind === 'result' && round) {
    summary.scores[game] ??= {};
    summary.scores[game][round] = {...event};
    if (Number.isFinite(event.score)) summary.state.score = event.score;
  }
  summary.missingCalls += updatePendingCalls(summary.pendingCalls,event,game,round);
  if (event.kind === 'model_finished' || event.kind === 'model_failed') {
    if (Number.isFinite(event.tokens) && event.tokens >= 0) {
      summary.tokens += event.tokens; summary.tokenCalls++;
      const u = event.usage;
      if (hasStructuredUsage(u)) summary.structured = true;
      else summary.legacy = true;
    } else summary.missingCalls++;
  }
}
