import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseVisibleFields, readVisibleGameState, readGameLayout, PageStateError} from '../src/page-state.mjs';

const snapshot = (extra = [], round = '1 / 5') => ({loginBlocked:false, fields:[{label:'回合',value:round}, ...extra]});
const field = (label,value) => ({label,value});
test('独立可见字段解析题号、总分和结果，不从题库名称推断状态', () => {
  assert.deepEqual(parseVisibleFields(snapshot([field('总分','1,234')])), {round:1,score:1234,result:null});
  assert.deepEqual(parseVisibleFields(snapshot([field('距离','123.45 km'),field('得分','2,345 / 5,000'),field('总分','2,346')],'2 / 5')), {round:2,score:2346,result:{distance:'123.45 km',points:2345}});
  assert.equal(parseVisibleFields(snapshot([field('距离','0 m'),field('得分','0 / 5000')])).result.points,0);
  assert.equal(parseVisibleFields(snapshot()).score,null);
});
test('缺失、重复和登录遮罩字段必须硬停止', () => {
  for (const value of [null,{}, {...snapshot(),loginBlocked:true},snapshot([field('回合','2 / 5')]),snapshot([field('总分','0'),field('总分','0')]),snapshot([field('距离','10 km')]),snapshot([field('得分','0 / 5000')]),snapshot([field('得分','')])]) assert.throws(()=>parseVisibleFields(value),PageStateError);
});
test('拒绝截断匹配、非法分隔、负数、非有限值和越界结果', () => {
  for (const round of ['0 / 5','6 / 5','01 / 5','1 / 50','1 / 5 trailing']) assert.throws(()=>parseVisibleFields(snapshot([],round)),PageStateError);
  for (const score of ['1,2','1,,000','01','-1','NaN','Infinity','25001','1abc','1.5']) assert.throws(()=>parseVisibleFields(snapshot([field('总分',score)])),PageStateError);
  for (const points of ['5001','-1','9,99','1foo']) assert.throws(()=>parseVisibleFields(snapshot([field('距离','1 km'),field('得分',`${points} / 5000`)])),PageStateError);
  for (const distance of ['-1 km','1..2 km','1,2 km','NaN m','Infinity m','40076 km','1e6 m','12. km','10 km extra']) assert.throws(()=>parseVisibleFields(snapshot([field('距离',distance),field('得分','0 / 5000')])),PageStateError);
});
test('页面读取协议异常和脚本异常均分类为状态硬停止', async () => {
  await assert.rejects(readVisibleGameState({call:async()=>{throw Error('disconnected')}}),PageStateError);
  await assert.rejects(readVisibleGameState({call:async()=>({exceptionDetails:{},result:{value:snapshot()}})}),PageStateError);
});
test('截图边界跟随可见题库字段，拒绝方位重叠与无可用街景区域', async () => {
  const data={...snapshot(),titleCount:1,protectedRects:[{x:0,y:0,width:150,height:110}]};
  const cdp={call:async()=>({result:{value:data}})},v={clientWidth:1200,clientHeight:900};
  assert.equal((await readGameLayout(cdp,v)).topOffset,110);
  data.protectedRects[0].width=600;
  await assert.rejects(readGameLayout(cdp,v),/重叠/);
  data.protectedRects[0]={x:0,y:300,width:150,height:500};
  await assert.rejects(readGameLayout(cdp,v),/没有足够/);
});
