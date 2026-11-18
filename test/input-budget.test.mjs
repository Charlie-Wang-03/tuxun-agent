import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInputBudget,BudgetExceededError} from '../src/input-budget.mjs';

function fixture(max=1){
  const state={actions:0};let left=100,stop=false;
  return {state,expire:()=>{left=0;},stop:()=>{stop=true;},budget:createInputBudget({state,remaining:()=>left,actionLimit:()=>max,stopped:()=>stop})};
}
test('复合动作只在首次派发扣额，最后一次额度允许正常释放',async()=>{
  const {budget,state}=fixture();const sent=[];
  await budget.run(async()=>{await budget.dispatch(()=>sent.push('press'));await budget.run(()=>budget.dispatch(()=>sent.push('release')));});
  assert.equal(state.actions,1);assert.deepEqual(sent,['press','release']);
  assert.throws(()=>budget.run(()=>budget.dispatch(()=>sent.push('extra'))),BudgetExceededError);
});
test('失败输入仍扣额，等待结束后重新检查时间和停止状态',async()=>{
  const f=fixture(2);const sent=[];
  await assert.rejects(f.budget.run(async()=>{await f.budget.dispatch(async()=>{sent.push('press');throw Error('ack failed');});}),/ack failed/);
  assert.equal(f.state.actions,1);
  await assert.rejects(f.budget.run(async()=>{await Promise.resolve();f.expire();f.budget.dispatch(()=>sent.push('late'));}),BudgetExceededError);
  assert.equal(f.state.actions,1);assert.deepEqual(sent,['press']);
  const g=fixture();
  await assert.rejects(g.budget.run(async()=>{await g.budget.dispatch(()=>sent.push('press2'));g.stop();g.budget.dispatch(()=>sent.push('release2'));}),/停止/);
  assert.deepEqual(sent,['press','press2']);
});
test('按下后时间耗尽不补发释放，也不退还额度',async()=>{
  const f=fixture();let calls=0;
  await assert.rejects(f.budget.run(async()=>{await f.budget.dispatch(()=>calls++);f.expire();f.budget.dispatch(()=>calls++);}),BudgetExceededError);
  assert.equal(calls,1);assert.equal(f.state.actions,1);
});
test('页面切换不消耗新题额度，但每次输入受显式切换期限约束',async()=>{
  const f=fixture();f.expire();let left=50,calls=0;
  await assert.rejects(f.budget.transition(async()=>{await f.budget.run(()=>f.budget.dispatch(()=>calls++));left=0;f.budget.dispatch(()=>calls++);},()=>left),BudgetExceededError);
  assert.equal(calls,1);assert.equal(f.state.actions,0);
  assert.throws(()=>f.budget.dispatch(()=>calls++),/预算作用域/);
});
