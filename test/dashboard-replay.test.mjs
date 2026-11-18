import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseReplay,parseReplayMetadata,indexReplay,replayAt,budgetValues,clockText,eventDetail,tokenText} from '../src/dashboard-model.mjs';
import {emptySummary,updateSummary} from '../src/dashboard-summary.mjs';
import {createReplayReader} from '../src/dashboard-model.mjs';

test('回放解析拒绝中间损坏行和非对象，允许末尾截断并验证来源声明',()=>{
  assert.throws(()=>parseReplay('{"kind":"started"}\ninvalid\n'),/第 2 行无效/);
  assert.equal(parseReplay('{"kind":"started"}\n{"kind":').truncated,true);
  assert.throws(()=>parseReplay('{"kind":"started"}\nnull'),/第 2 行无效/);
  assert.throws(()=>parseReplayMetadata('{"schema_version":1,"source":"real","editing":"redacted","recorded_at":"not-a-date"}'),/录制时间无效/);
  assert.throws(()=>parseReplayMetadata('{"schema_version":2,"source":"real","editing":"redacted"}'),/说明格式无效/);
  assert.equal(parseReplayMetadata('{"schema_version":1,"source":"simulated","editing":"none"}').source,'simulated');
});

test('跨题和跨局不沿用旧观察、预算、核对或截图，结果保留零分',()=>{
  const events=[{kind:'started',mode:'fixed',limits:{games:2}},{kind:'state',round:1,game:1,roundStart:100,roundLimit:300},
    {kind:'decision',screenshot:'first.png',action:{type:'hover',observation:'本题道路',reason:'观察地图'}},
    {kind:'selection_audit',verdict:'match',reason:'图钉匹配'},
    {kind:'result',round:1,points:0,score:0,forced:true,forced_detail:{trigger:'模型超时'}},
    {kind:'next_round_verified',from:1,to:2},{kind:'decision',action:{type:'hover',observation:'新题线索'}},
    {kind:'restart_verified',from:1,to:2,game:2},{kind:'state',game:2,round:1,score:0}];
  const rows=indexReplay(events), first=replayAt(rows,5);
  assert.equal(first.screenshot.name,'first.png');assert.equal(first.summary.scores[1][1].points,0);
  assert.equal(first.summary.scores[1][1].forced_detail.trigger,'模型超时');
  const next=replayAt(rows,6);
  assert.equal(next.screenshot,null);assert.equal(next.summary.observation,null);assert.equal(next.summary.latestAudit,null);
  assert.equal(next.summary.state.round,2);assert.equal(next.summary.state.roundStart,undefined);
  const restarted=replayAt(rows,8);assert.equal(restarted.screenshot,null);assert.equal(restarted.summary.state.game,2);
  assert.equal(restarted.summary.observation,null);assert.equal(restarted.summary.state.score,undefined);
  assert.equal(replayAt(rows,9).summary.state.score,0);
});

test('回放事件能定位精确截图，缺失文件名不回退到旧图，向后跳转重新计算用量',()=>{
  const rows=indexReplay([{kind:'started'},{kind:'state',round:1},{kind:'decision',screenshot:'one.png'},
    {kind:'model_finished',tokens:10,usage:{input_tokens:8,cached_input_tokens:0,output_tokens:2}},
    {kind:'model_failed',tokens:null},{kind:'result',round:1,points:1234,screenshot:'missing.png'},{kind:'model_finished',tokens:2}]);
  assert.equal(replayAt(rows,3).screenshot.index,2);
  assert.equal(replayAt(rows,6).screenshot.name,'missing.png');
  assert.equal(tokenText(replayAt(rows,5).summary),'10（部分未知）');
  assert.match(tokenText(replayAt(rows,7).summary),/口径混合/);
  assert.equal(replayAt(rows,3).summary.tokens,0);
});

test('预算只从已知运行状态计算，不把过期或缺失数据伪造为零',()=>{
  const snapshot={running:true,summary:{started:{limits:{totalSeconds:1800}},state:{roundLimit:300,roundStart:1000,start:1000,actionLimit:35,actions:2}}};
  assert.deepEqual(budgetValues(snapshot,101000),{round:200,game:1700,actions:33});
  assert.equal(clockText(138),'02:18');
  assert.equal(budgetValues({...snapshot,running:false}),null);
  assert.equal(budgetValues({running:true,summary:{state:{}}}),null);
  assert.deepEqual(budgetValues(snapshot,1901000),{round:0,game:0,actions:33});
});

test('新选点清除旧核对，同题观察保留，启动新运行清除旧分数',()=>{
  const summary=emptySummary();
  for(const e of [{kind:'state',round:1},{kind:'decision',action:{observation:'路牌'}},{kind:'selection_audit',round:1,verdict:'match'},
    {kind:'decision',action:{type:'map_select',reason:'改选'}}])updateSummary(summary,e);
  assert.equal(summary.latestAudit,null);assert.equal(summary.observation,'路牌');
  updateSummary(summary,{kind:'result',round:1,points:50});updateSummary(summary,{kind:'started',mode:'move'});
  assert.deepEqual(summary.scores,{});assert.equal(summary.observation,null);
});

test('事件描述不把图钉一致当作定位正确，缺失结果区别于零分',()=>{
  assert.match(eventDetail({kind:'selection_audit',verdict:'match',reason:'道路交叉处'}),/与目标描述一致/);
  assert.match(eventDetail({kind:'result'}),/得分 未记录/);
  assert.match(eventDetail({kind:'result',points:0}),/得分 0\/5000/);
  assert.match(eventDetail({kind:'action_executed',type:'click',target:'confirm'}),/以网站记录为准/);
});

test('增量和检查点跳转与原始完整归约一致，跨局、缺图及未结束用量不丢失',()=>{
  const events=[{kind:'started',mode:'fixed',limits:{games:2}}];
  for(let i=0;i<900;i++){
    const game=i<450?1:2,round=Math.floor((i%450)/90)+1;
    events.push({kind:'state',game,round,score:i,roundStart:i});
    if(i%3===0)events.push({kind:'model_start',label:'相同名称'});
    if(i%3===1)events.push({kind:'model_finished',label:'相同名称',tokens:i,usage:i%2?{input_tokens:i,cached_input_tokens:0,output_tokens:0}:null});
    if(i%11===0)events.push({kind:'decision',action:{type:'hover',observation:`线索${i}`},screenshot:i%2?'missing.png':'map-detail.png'});
    if(i%90===89)events.push({kind:'result',round,points:0,score:i});
  }
  const rows=indexReplay(events),reader=createReplayReader(rows);
  for(const pos of [0,1,2,500,1100,rows.length,1025,256,255,257,1,900,rows.length,0])assert.deepEqual(reader.at(pos),replayAt(rows,pos),String(pos));
  for(let pos=700;pos<740;pos++)assert.deepEqual(reader.at(pos),replayAt(rows,pos));
  const retained=reader.at(1000),copy=structuredClone(retained);reader.at(rows.length);assert.deepEqual(retained,copy,'后续播放不能改变已经返回的快照');
  assert.equal(reader.roundStart(2,1).game,2);assert.equal(reader.gameStart(2).round,1);
});

test('长回放每步归约有界，时间线和日志窗口保持可导航而不截断原始事件',()=>{
  const rows=indexReplay(Array.from({length:50000},(_,i)=>({kind:'decision',game:1,round:1,action:{observation:`事件${i}`}})));
  let accesses=0;
  const counted=rows.map(row=>({...row,get event(){accesses++;return row.event}}));
  const reader=createReplayReader(counted);accesses=0;
  reader.at(49900);assert.ok(accesses<8000,'随机跳转只归约最近检查点后的事件');
  accesses=0;for(let i=49901;i<=50000;i++)reader.at(i);assert.ok(accesses<1000,'连续播放不重放前缀');
  for(const pos of [1,25000,50000]){
    const window=reader.timeline(1,1,pos);assert.equal(window.total,50000);assert.ok(window.rows.length<=120);assert.ok(window.rows.some(r=>r.index===pos-1));
    const log=reader.log(pos);assert.ok(log.end-log.start<=120);assert.match(log.text,new RegExp(`事件${pos-1}`));
  }
  const huge={kind:'diagnostic',text:'x'.repeat(20000)},long=createReplayReader(indexReplay([huge]));
  assert.equal(long.log(1).shortened,true);assert.ok(long.log(1).text.length<=4001);assert.equal(huge.text.length,20000);
});
