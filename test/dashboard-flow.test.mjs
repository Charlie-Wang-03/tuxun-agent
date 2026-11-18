import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fork,spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {createDashboardServer} from '../src/dashboard-server.mjs';
import {listenBrowserSafe} from '../src/browser-port.mjs';

test('控制台使用模拟子进程启动、汇报状态并停止', async t => {
  let child, actualArgs;
  const server = createDashboardServer({
    launchWorker: args => { actualArgs=args; child=fork('test/fixtures/synthetic-worker.mjs',[],{silent:true,windowsHide:true}); return child; },
    capture:async()=>Buffer.from('synthetic'),
    readEvents:async()=>'{"kind":"synthetic_complete_log"}\n'
  });
  await listenBrowserSafe(server);
  t.after(async()=>{if(child && child.exitCode===null)child.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  let page;
  try {page=await fetch(base)} catch(error) {if(error.cause?.code==='EACCES'){t.skip('当前沙箱阻止本机回环连接');return}throw error}
  const token=(await page.text()).match(/const token='([0-9a-f]+)'/)[1];
  const headers={'x-dashboard-token':token,'content-type':'application/json',origin:base};
  const tooLong=await fetch(base+'/api/start',{method:'POST',headers,body:JSON.stringify({confirm:true,mode:'fixed',roundSeconds:20,initialRoundSeconds:21,totalSeconds:60,maxActions:5})});
  assert.equal(tooLong.status,400);
  const start=await fetch(base+'/api/start',{method:'POST',headers,body:JSON.stringify({confirm:true,mode:'fixed',games:2,roundSeconds:20,initialRoundSeconds:12,totalSeconds:60,maxActions:5})});
  assert.equal(start.status,202);
  assert.deepEqual(actualArgs,['--mode','fixed','--round-seconds','20','--total-seconds','60','--max-actions','5','--games','2','--initial-round-seconds','12']);
  const status=async()=>(await(await fetch(base+'/api/status',{headers:{'x-dashboard-token':token}})).json());
  let state;
  for(let i=0;i<100;i++){state=await status();if(state.summary.state && state.lines.includes('分段中文输出'))break;await delay(20)}
  assert.equal(state.running,true);
  assert.equal((await fetch(base+'/api/events?run='+state.runId)).status,403);
  assert.equal((await fetch(base+'/api/events?run=old',{headers})).status,409);
  assert.match(await(await fetch(base+'/api/events?run='+state.runId,{headers})).text(),/synthetic_complete_log/);
  assert.equal(state.summary.state.round,1);
  assert.ok(state.lines.includes('分段中文输出'));
  assert.equal((await fetch(base+'/api/start',{method:'POST',headers,body:'{}'})).status,409);
  assert.equal((await fetch(base+'/api/stop',{method:'POST',headers})).status,202);
  for(let i=0;i<100;i++){state=await status();if(!state.running)break;await delay(20)}
  assert.equal(state.running,false);
  assert.match(state.outcome,/模拟停止/);
  assert.equal(state.events.some(event=>event.kind==='submit_current'),false);
});

test('子进程无法启动时释放运行状态并报告未知结果', async t => {
  const server=createDashboardServer({launchWorker:()=>spawn('tuxun-nonexistent-test-worker-9f51',[],{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true})});
  await listenBrowserSafe(server);
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
  const base=`http://127.0.0.1:${server.address().port}`;
  let page;
  try {page=await fetch(base)} catch(error) {if(error.cause?.code==='EACCES'){t.skip('当前沙箱阻止本机回环连接');return}throw error}
  const token=(await page.text()).match(/const token='([0-9a-f]+)'/)[1];
  const headers={'x-dashboard-token':token,'content-type':'application/json',origin:base};
  assert.equal((await fetch(base+'/api/start',{method:'POST',headers,body:JSON.stringify({confirm:true,mode:'fixed',roundSeconds:20,totalSeconds:60,maxActions:5})})).status,202);
  let state;
  for(let i=0;i<100;i++){state=await(await fetch(base+'/api/status',{headers:{'x-dashboard-token':token}})).json();if(!state.running)break;await delay(20)}
  assert.equal(state.running,false);
  assert.match(state.outcome,/进程错误/);
  assert.match(state.outcome,/提交状态未知/);
});

test('停止消息发送失败时保持运行状态并允许重试', async t => {
  const child = new EventEmitter();
  child.stdout=new PassThrough(); child.stderr=new PassThrough(); child.connected=true;
  child.send=(_message,callback)=>{setImmediate(()=>callback(Error('模拟通道错误')));return false};
  const server=createDashboardServer({launchWorker:()=>child});
  await listenBrowserSafe(server);
  t.after(async()=>{child.stdout.destroy();child.stderr.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
  const base=`http://127.0.0.1:${server.address().port}`;
  let page;
  try {page=await fetch(base)} catch(error) {if(error.cause?.code==='EACCES'){t.skip('当前沙箱阻止本机回环连接');return}throw error}
  const token=(await page.text()).match(/const token='([0-9a-f]+)'/)[1];
  const headers={'x-dashboard-token':token,'content-type':'application/json',origin:base};
  assert.equal((await fetch(base+'/api/start',{method:'POST',headers,body:JSON.stringify({confirm:true,mode:'fixed',roundSeconds:20,totalSeconds:60,maxActions:5})})).status,202);
  assert.equal((await fetch(base+'/api/stop',{method:'POST',headers})).status,202);
  let state;
  for(let i=0;i<100;i++){state=await(await fetch(base+'/api/status',{headers:{'x-dashboard-token':token}})).json();if(state.stopError)break;await delay(20)}
  assert.equal(state.running,true);
  assert.equal(state.stopping,false);
  assert.match(state.stopError,/未送达/);
  assert.equal((await fetch(base+'/api/stop',{method:'POST',headers})).status,202);
  child.emit('close',null,'SIGTERM');
});
