import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performMove, recoverUnconfirmedMovement, MovementUnconfirmedError } from '../src/movement.mjs';
const frame = value => ({width:2,height:2,black:false,sample:[value,value,value,value]});
const clock = () => { let ms=0;return {now:()=>ms, wait:async n=>{ms+=n}}; };
test('固定模式拒绝移动，且不会点击', async()=>{let clicks=0;await assert.rejects(performMove({mode:'fixed',capture:async()=>frame(0),click:async()=>clicks++,...clock()}),/固定模式/);assert.equal(clicks,0)});
test('移动后画面长期不变时停止，不重复点击', async()=>{let clicks=0,probes=0;const c=clock();await assert.rejects(performMove({mode:'move',capture:async()=>frame(40),click:async()=>clicks++,...c,timeoutMs:6000,intervalMs:2000,onProbe:async()=>probes++}),/画面变化不足/);assert.equal(clicks,1);assert.equal(probes,3);assert.equal(c.now(),6000)});
test('延迟换景会继续等待并记录结果',async()=>{let clicks=0,probes=0;const c=clock();const r=await performMove({mode:'move',capture:async phase=>frame(phase==='before'||c.now()<8000?40:90),click:async()=>clicks++,...c,timeoutMs:25000,intervalMs:2000,onProbe:async()=>probes++});assert.equal(clicks,1);assert.equal(probes,4);assert.equal(c.now(),8000);assert.equal(r.changed,true)});
test('换景期间黑屏会继续等待',async()=>{const c=clock();const r=await performMove({mode:'move',capture:async phase=>phase==='before'?frame(40):c.now()<4000?{...frame(0),black:true}:frame(90),click:async()=>{},...c,timeoutMs:6000,intervalMs:2000});assert.equal(r.changed,true)});
test('未确认变化时只点击一次，安全悬停地图并保留观察',async()=>{
  let clicks=0,hovers=0,checks=0;const c=clock();let failure;
  try{await performMove({mode:'move',capture:async()=>frame(40),click:async()=>clicks++,...c,timeoutMs:2000,intervalMs:2000});}catch(e){failure=e;}
  const recovered=await recoverUnconfirmedMovement({error:failure,action:{type:'move_road',observation:'可见山路',round:2},eligible:()=>true,verify:async()=>checks++,map:async()=>({x:400,y:100,width:400,height:300}),width:1000,height:600,topOffset:70,lookup:async()=> 'map',hover:async()=>hovers++});
  assert.ok(failure instanceof MovementUnconfirmedError);assert.equal(clicks,1);assert.equal(hovers,1);assert.equal(checks,2);assert.equal(recovered.type,'hover');assert.equal(recovered.observation,'可见山路');
});
test('黑屏、预算不足、地图不可信或题目变化均不会执行恢复悬停',async()=>{
  let hovers=0;const base={action:{type:'move_arrow'},eligible:()=>true,verify:async()=>{},map:async()=>({x:400,y:100,width:400,height:300}),width:1000,height:600,topOffset:70,lookup:async()=> 'map',hover:async()=>hovers++};
  assert.equal(await recoverUnconfirmedMovement({...base,error:Error('黑屏')}),null);
  const error=new MovementUnconfirmedError('未确认');
  assert.equal(await recoverUnconfirmedMovement({...base,error,eligible:()=>false}),null);
  assert.equal(await recoverUnconfirmedMovement({...base,error,lookup:async()=> 'panorama'}),null);
  await assert.rejects(recoverUnconfirmedMovement({...base,error,verify:async()=>{throw Error('题目已变化')}}),/题目已变化/);
  assert.equal(hovers,0);
});
