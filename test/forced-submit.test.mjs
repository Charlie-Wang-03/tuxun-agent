import {test}from'node:test';import assert from'node:assert/strict';import{forceSubmitRound}from'../src/forced-submit.mjs';
const base=()=>({round:1,read:async()=>({round:1,result:null}),remaining:()=>1000,log:async()=>{},submit:async()=>{},selectFallback:async()=>({x:10,y:20})});
test('已有图钉即使没有模型确认也只提交一次',async()=>{let n=0;const b=base();const r=await forceSubmitRound({...b,inspect:async()=>({pins:1,pin:{x:1,y:2},confirm:{x:4,y:5}}),submit:async()=>n++});assert.equal(r.source,'existing_pin');assert.equal(n,1)});
test('无选点时先选地图位置并确认图钉后提交',async()=>{let selected=false,n=0;const b=base();const r=await forceSubmitRound({...b,inspect:async()=>selected?{pins:1,pin:{x:10,y:20},confirm:{x:4,y:5}}:{pins:0},selectFallback:async()=>{selected=true;return{x:10,y:20}},submit:async()=>n++});assert.equal(r.source,'map_center');assert.equal(n,1)});
test('题号改变、图钉不确定或时间耗尽时不会误提交',async()=>{let n=0;const b=base();for(const v of [{...b,read:async()=>({round:2})},{...b,inspect:async()=>({pins:2})},{...b,remaining:()=>0}]){await assert.rejects(forceSubmitRound({...v,submit:async()=>n++}));}assert.equal(n,0)});
test('已进入结果页不重复提交',async()=>{let n=0;const b=base();const r=await forceSubmitRound({...b,read:async()=>({round:1,result:{points:1}}),submit:async()=>n++});assert.equal(r.alreadyResult,true);assert.equal(n,0)});
test('兜底为模型调用预留一分钟并保留操作额度',async()=>{const {shouldForceSubmit,decisionTimeoutBeforeForce}=await import('../src/forced-submit.mjs');assert.equal(shouldForceSubmit(60000,0,35),true);assert.equal(shouldForceSubmit(61000,32,35),true);assert.equal(shouldForceSubmit(61000,31,35),false);assert.equal(decisionTimeoutBeforeForce(100000),40000)});
test('提示按提交预留与阶段上限说明调用时限，不冒充总剩余时间',async()=>{
  const {decisionTimeoutBeforeForce,decisionBudgetHint}=await import('../src/forced-submit.mjs');
  assert.match(decisionBudgetHint(decisionTimeoutBeforeForce(300000)),/调用时限约 240 秒/);
  assert.match(decisionBudgetHint(decisionTimeoutBeforeForce(120000,45000)),/调用时限约 45 秒/);
  assert.match(decisionBudgetHint(40000),/不是本题或本局的剩余总时间/);
});
test('地图按钮延迟出现时等待，不重复选点',async()=>{let selected=0,reads=0,submits=0;const b=base();await forceSubmitRound({...b,inspect:async()=>{reads++;return selected?{pins:1,pin:{x:10,y:20},confirm:reads>=4?{x:3,y:4}:null}:{pins:0}},selectFallback:async()=>{selected++;return{x:10,y:20}},wait:async()=>{},submit:async()=>submits++});assert.equal(selected,1);assert.equal(submits,1)});
test('提交异常不会自动重复提交',async()=>{let submits=0;const b=base();await assert.rejects(forceSubmitRound({...b,inspect:async()=>({pins:1,pin:{x:1,y:2},confirm:{x:3,y:4}}),submit:async()=>{submits++;throw Error('结果尚未确认')}}),/结果尚未确认/);assert.equal(submits,1)});
test('兜底选点未形成对应图钉时不会提交',async()=>{let n=0;const b=base();await assert.rejects(forceSubmitRound({...b,inspect:async()=>({pins:0}),wait:async()=>{},submit:async()=>n++}),/无法确认图钉/);assert.equal(n,0)});
test('记录截图期间时间耗尽时不会越过截止时间提交',async()=>{let available=1000,n=0;const b=base();await assert.rejects(forceSubmitRound({...b,remaining:()=>available,inspect:async()=>({pins:1,pin:{x:1,y:2},confirm:{x:3,y:4}}),log:async()=>{available=0},submit:async()=>n++}),/时间上限/);assert.equal(n,0)});
test('兜底准备提交期间收到停止请求，不发送新的浏览器输入',async()=>{
  const {createStopControl}=await import('../src/stop-control.mjs');
  const control=createStopControl(), b=base(); let dispatched=0;
  await assert.rejects(forceSubmitRound({...b,
    inspect:async()=>({pins:1,pin:{x:1,y:2},confirm:{x:3,y:4}}),
    log:async event=>{if(event.kind==='forced_submit_attempt')control.stop()},
    submit:async()=>{control.guard('Input.dispatchMouseEvent');dispatched++}
  }),/停止/);
  assert.equal(dispatched,0);
});
