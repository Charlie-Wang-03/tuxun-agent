import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseEvents,summarizeEvents,formatReview} from '../src/review.mjs';
const event=(kind,more={})=>({kind,time:'2026-11-10T00:00:00Z',...more});
test('五题结果、耗时、模型用量和兜底均可追溯',()=>{
 const e=[event('started',{mode:'move'}),...Array.from({length:5},(_,i)=>[event('state',{round:i+1}),event('model_start',{label:'判断'}),event('model_finished',{label:'判断',elapsed_ms:1200,tokens:110,usage:{input_tokens:100,cached_input_tokens:40,output_tokens:10}}),event('result',{round:i+1,points:1000+i,distance:'10 km',forced:i===1,forced_detail:i===1?{source:'existing_pin',trigger:'超时'}:null,time:'2026-11-10T00:00:20Z'})]).flat(),event('stopped',{reason:'五题完成',time:'2026-11-10T00:02:00Z'})];
 const s=summarizeEvents(e),text=formatReview(s,'run');assert.equal(s.resultCount,5);assert.equal(s.modelCalls,5);assert.equal(s.usage.cached,200);assert.equal(s.elapsed,120);assert.equal(s.rounds[1].elapsed,20);assert.match(text,/兜底：已有图钉，超时/);assert.match(text,/输入 500，其中缓存 200，输出 50/);
});
test('部分运行、超时和未结束调用均标记未知',()=>{
 const e=[event('started'),event('state',{round:1}),event('model_start',{label:'地图'}),event('model_failed',{label:'地图',elapsed_ms:500,tokens:null,reason:'超时'}),event('model_start',{label:'未完成'})];
 const s=summarizeEvents(e),text=formatReview(s,'run');assert.equal(s.modelCalls,2);assert.equal(s.usage.missingCalls,2);assert.match(text,/第 1 题：结果未知/);assert.match(text,/没有停止记录/);assert.match(text,/2 次用量未知/);assert.match(text,/未记录结束/);
});
test('旧版和新版 token 混合时不假定口径一致',()=>{
 const s=summarizeEvents([event('model_finished',{tokens:300,elapsed_ms:1}),event('model_finished',{tokens:110,elapsed_ms:1,usage:{input_tokens:100,cached_input_tokens:20,output_tokens:10}})]);assert.match(formatReview(s,'run'),/token：不可合并/);assert.match(formatReview(s,'run'),/混合，不宜比较/);assert.match(formatReview(s,'run'),/未覆盖全部调用/);
});
test('不完整的尾行可提示，其他损坏数据报错',()=>{
 const valid=JSON.stringify(event('started'));assert.equal(parseEvents(valid+'\n{"kind":').truncated,true);assert.throws(()=>parseEvents(valid+'\nnot-json\n'+valid),/第 2 行/);assert.throws(()=>parseEvents(''),/没有可读取/);
 for(const scalar of ['null','[]','123','"wrong"'])assert.throws(()=>parseEvents(valid+'\n'+scalar),/第 2 行无效/);
});
test('缺少轮次起始时间时不虚构耗时或兜底状态',()=>{
 const s=summarizeEvents([event('result',{round:3,points:7})]);assert.equal(s.rounds[2].elapsed,null);assert.match(formatReview(s,'run'),/第 3 题：7\/5000；距离 未知；耗时 未知/);assert.match(formatReview(s,'run'),/兜底状态未知/);
});
test('多局的相同题号分别统计且保持各自成绩',()=>{
 const e=[event('started',{limits:{games:2}}),event('state',{game:1,round:1}),event('result',{game:1,round:1,points:100,score:100}),event('restart_verified',{game:2}),event('state',{game:2,round:1}),event('result',{game:2,round:1,points:200,score:200})];
 const s=summarizeEvents(e),text=formatReview(s,'run');assert.equal(s.resultCount,2);assert.equal(s.games.get(1)[0].result.points,100);assert.equal(s.games.get(2)[0].result.points,200);assert.match(text,/第 1 局：/);assert.match(text,/第 2 局：/);assert.match(text,/2\/10/);
});
test('跨局同名调用不能覆盖此前未结束调用，负用量不能成为旧版统计',()=>{
  const s=summarizeEvents([
    event('state',{game:1,round:1}),event('model_start',{label:'地图'}),
    event('state',{game:2,round:1}),event('model_start',{label:'地图'}),
    event('model_finished',{label:'地图',tokens:10,elapsed_ms:1}),
    event('model_failed',{label:'另一次',tokens:-1})
  ]);
  assert.equal(s.issues.find(e=>e.kind==='model_unfinished').game,1);
  assert.equal(s.games.get(1)[0].missingTokens,1);
  assert.equal(s.usage.legacyCalls,1);
  assert.equal(s.knownTokens,10);
});
