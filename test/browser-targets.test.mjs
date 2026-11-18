import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readBrowserTargets,singleGamePage} from '../src/browser-targets.mjs';

const page={id:'game',type:'page',url:'https://tuxun.fun/challenge/00000000-0000-4000-8000-000000000000',title:'题库经典五题 - 图寻 - 探索世界'};
test('专用浏览器拒绝额外标签页及被替换的游戏页面',()=>{
  assert.equal(singleGamePage([page,{type:'worker'}],'game'),page);
  assert.equal(singleGamePage([page,{type:'page',url:'about:blank'}]),null);
  assert.equal(singleGamePage([page],'other'),null);
  assert.equal(singleGamePage([{...page,title:'每日挑战'}]),null);
  assert.equal(singleGamePage([]),null);
});
test('浏览器列表读取检查 HTTP 状态、结构及超时',async()=>{
  await assert.rejects(readBrowserTargets(12345,{fetchTargets:async()=>({ok:false})}),/无法读取/);
  await assert.rejects(readBrowserTargets(12345,{fetchTargets:async()=>({ok:true,json:async()=>({})})}),/列表无效/);
  // Keep the test alive while AbortSignal's unreferenced timer fires.
  const keepAlive=setTimeout(()=>{},1000);
  try {
    await assert.rejects(readBrowserTargets(12345,{timeoutMs:10,fetchTargets:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))}),{name:'TimeoutError'});
  } finally {clearTimeout(keepAlive);}
});
