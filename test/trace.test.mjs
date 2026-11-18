import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrace } from '../src/trace.mjs';

test('终端区分决策、执行与核对，并安全展示模型文字',()=>{
  const lines=[];const trace=createTrace({write:line=>lines.push(line),time:()=>new Date('2026-01-01T00:00:00Z')});
  trace.event({kind:'decision',action:{type:'map_select',x:.25,y:.75,observation:'看到道路\u001b[2J',reason:'选择可能区域'},tokens:100});
  trace.event({kind:'selection_audit',verdict:'mismatch',reason:'标记不一致'});
  trace.event({kind:'action_executed',type:'map_select',target:'map'});
  assert.match(lines[0],/观察.*看到道路/);assert.doesNotMatch(lines.join(''),/\u001b/);
  assert.match(lines[1],/判断.*选择可能区域/);assert.match(lines[2],/计划.*地图选点.*地图局部.*0\.250/);
  assert.match(lines[3],/选点核对.*mismatch/);assert.match(lines[4],/完成.*地图选点/);
});
test('题号变化、模型等待和停止信息可实时输出',()=>{
  const lines=[];const trace=createTrace({write:line=>lines.push(line)});
  trace.event({kind:'state',round:1,score:0});trace.event({kind:'state',round:1,score:0});
  trace.event({kind:'model_start',label:'分析街景'});trace.progress('分析街景',10);
  trace.event({kind:'stopped',reason:'时间上限'});
  assert.equal(lines.length,4);assert.match(lines[1],/模型.*分析街景/);assert.match(lines[2],/等待.*10 秒/);assert.match(lines[3],/停止.*时间上限/);
});

test('范围级结果在终端明确标记',()=>{
 const lines=[];const trace=createTrace({write:line=>lines.push(line)});trace.event({kind:'approximate_submit_attempt',reason:'边界不清'});trace.event({kind:'approximate_submitted'});assert.match(lines[0],/范围级结果.*不确定/);assert.match(lines[1],/范围级结果.*已提交/);
});
