import {test} from 'node:test';
import assert from 'node:assert/strict';
import {restartGame} from '../src/restart-game.mjs';

test('只点击一次，确认新局首题后返回',async()=>{
  let clicks=0,reads=0;const state=await restartGame({findButton:async()=>({x:2,y:3}),click:async()=>clicks++,guard:async()=>{},wait:async()=>{},read:async()=>++reads===1?null:{round:1,score:0,result:null}});
  assert.equal(clicks,1);assert.equal(reads,2);assert.equal(state.round,1);
});
test('缺少按钮、未确认新局或收到停止时绝不重复点击',async()=>{
  let clicks=0;const base={findButton:async()=>({x:2,y:3}),click:async()=>clicks++,guard:async()=>{},wait:async()=>{},read:async()=>({round:5,score:10,result:{}}),attempts:2};
  await assert.rejects(restartGame({...base,findButton:async()=>null}),/无法确认/);assert.equal(clicks,0);
  await assert.rejects(restartGame(base),/未确认新一局/);assert.equal(clicks,1);
  let checks=0;await assert.rejects(restartGame({...base,guard:async()=>{if(++checks===2)throw Error('用户已请求停止')}}),/停止/);assert.equal(clicks,1);
});
