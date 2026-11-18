import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptySummary, updateSummary} from '../src/dashboard-summary.mjs';
import {summarizeEvents} from '../src/review-data.mjs';
import {tokenText} from '../src/dashboard-model.mjs';

test('运行摘要保留早期状态，区分缺失用量与混合口径', () => {
  const summary = emptySummary();
  updateSummary(summary, {kind:'started',mode:'fixed'});
  updateSummary(summary, {kind:'model_finished',tokens:12,usage:{input_tokens:10,cached_input_tokens:0,output_tokens:2}});
  for (let i=0;i<600;i++) updateSummary(summary, {kind:'state',round:1,actions:i});
  updateSummary(summary, {kind:'model_failed',tokens:null});
  assert.equal(summary.started.mode, 'fixed');
  assert.equal(summary.state.actions, 599);
  assert.equal(summary.tokens, 12);
  assert.equal(summary.missingCalls, 1);
  updateSummary(summary, {kind:'model_finished',tokens:5});
  assert.equal(summary.legacy && summary.structured, true);
});

test('不完整的用量结构不当作新版统计，负 token 计为未知', () => {
  const summary=emptySummary();
  updateSummary(summary,{kind:'model_finished',tokens:3,usage:{input_tokens:2}});
  updateSummary(summary,{kind:'model_failed',tokens:-1});
  assert.equal(summary.structured,false);
  assert.equal(summary.legacy,true);
  assert.equal(summary.tokens,3);
  assert.equal(summary.missingCalls,1);
});

test('运行阶段、图钉核对和多局成绩保留在摘要中',()=>{
  const s=emptySummary();updateSummary(s,{kind:'model_start',label:'分析地图',time:'2026-11-11T00:00:00Z'});assert.equal(s.phase.label,'分析地图');
  updateSummary(s,{kind:'selection_audit',game:2,round:3,verdict:'uncertain',reason:'范围不清'});assert.equal(s.latestAudit.game,2);
  updateSummary(s,{kind:'result',game:1,round:3,points:150,forced:true});updateSummary(s,{kind:'result',game:2,round:3,points:300});
  assert.equal(s.scores[1][3].points,150);assert.equal(s.scores[1][3].forced,true);assert.equal(s.scores[2][3].points,300);
  updateSummary(s,{kind:'restart_attempt'});assert.equal(s.phase.label,'正在重开');
});

test('实时用量与离线复盘对未结束、跨局同名及失败调用保持一致',()=>{
  const events=[
    {kind:'started'}, {kind:'state',game:1,round:1},
    {kind:'model_start',label:'地图'},
    {kind:'model_finished',label:'地图',tokens:12,usage:{input_tokens:10,cached_input_tokens:2,output_tokens:2}},
    {kind:'model_start',label:'地图'},
    {kind:'state',game:2,round:1}, {kind:'model_start',label:'地图'},
    {kind:'model_finished',label:'地图',tokens:3},
    {kind:'model_start',label:'核对'}, {kind:'model_failed',label:'核对',tokens:null},
    {kind:'stopped'}
  ];
  const summary=emptySummary();
  events.forEach((event,index)=>{
    updateSummary(summary,event);
    const review=summarizeEvents(events.slice(0,index+1));
    assert.equal(summary.tokens,review.knownTokens);
    assert.equal(summary.tokenCalls,review.knownTokenCalls);
    assert.equal(summary.missingCalls,review.usage.missingCalls);
    assert.equal(summary.structured,review.usage.structuredCalls>0);
    assert.equal(summary.legacy,review.usage.legacyCalls>0);
    if(index===4)assert.equal(tokenText(summary),'12（部分未知）');
  });
  assert.equal(summary.missingCalls,2);
  assert.equal(summary.pendingCalls.length,1);
  updateSummary(summary,{kind:'started'});
  assert.equal(summary.missingCalls,0);assert.deepEqual(summary.pendingCalls,[]);
});

test('新局缺少题号时清除前一局题目，不给未知题号套用旧上下文',()=>{
  const summary=emptySummary();
  updateSummary(summary,{kind:'state',game:1,round:5});
  updateSummary(summary,{kind:'decision',action:{observation:'旧题线索'}});
  updateSummary(summary,{kind:'model_start',game:2,label:'地图'});
  assert.equal(summary.observation,null);
  assert.equal(summary.state.game,2);assert.equal(summary.state.round,undefined);
  assert.equal(summary.pendingCalls[0].round,null);
});
