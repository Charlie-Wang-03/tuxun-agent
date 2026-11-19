import { pngCrc32 } from '../../src/image-check.mjs';
// Real CLI against a synthetic, local-only DevTools endpoint. No game/model access.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {fork} from 'node:child_process';
import {cp,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createDashboardServer} from '../../src/dashboard-server.mjs';
import {listenBrowserSafe} from '../../src/browser-port.mjs';
import {acquireRunLock} from '../../src/run-lock.mjs';

const tempRoot = await realpath(tmpdir());
const workspace = await mkdtemp(path.join(tempRoot,'tuxun-stop-'));
const source = fileURLToPath(new URL('../../src',import.meta.url));
await cp(source,path.join(workspace,'src'),{recursive:true});
const signalRead=process.argv.includes('--signal-read');
const signalInput=process.argv.includes('--signal-input');
const signalModel=process.argv.includes('--signal-model');
const signalScenario=signalRead||signalInput||signalModel;
const signalName=process.argv.includes('--sigterm')?'SIGTERM':'SIGINT';
const lockScenario=process.argv.includes('--lock-contention');
const budgetBefore=process.argv.includes('--budget-before-input');
const budgetRelease=process.argv.includes('--budget-before-release');
const budgetFallback=process.argv.includes('--budget-fallback');
const inputFailure=process.argv.includes('--input-failure');
const budgetScenario=budgetBefore||budgetRelease||budgetFallback||inputFailure;
const inputScenario = process.argv.includes('--inflight-input') || signalInput;
const submitScenario = process.argv.includes('--synthetic-submit');
const reportFailureScenario = process.argv.includes('--report-failure');
const captureScenario = process.argv.includes('--capture-failure') || reportFailureScenario;
const mapCaptureScenario = process.argv.includes('--map-capture-failure');
const auditCaptureScenario = process.argv.includes('--audit-capture-failure');
const forcedCaptureScenario = process.argv.includes('--forced-capture-failure');
const mapOnlyScenario=process.argv.includes('--map-only-capture');
const syntheticInputs=[];
const evidenceFailure=process.argv.find(a=>a.startsWith('--evidence-failure='))?.split('=')[1];
const evidenceCases=['decode-street','decode-map','write-street','write-compass','write-map','read-map','write-audit','read-audit','write-forced','write-result','write-events','read-model','bad-state'];
if(evidenceFailure&&!evidenceCases.includes(evidenceFailure))throw Error('未知证据故障场景');
const auditDecision=auditCaptureScenario||['read-map','write-audit','read-audit'].includes(evidenceFailure);
let failureTriggered=false,inputsAfterFailure=[];
const nestedCapture = mapOnlyScenario || Boolean(evidenceFailure) || mapCaptureScenario || auditCaptureScenario || forcedCaptureScenario || signalModel || budgetFallback;
const smallViewportScenario = process.argv.includes('--small-viewport');
const restartScenario = process.argv.includes('--restart-game');
const restartCompleteScenario = process.argv.includes('--restart-complete');
const modeScenario = process.argv.includes('--mode-unconfirmed');
const modeBudgetScenario = process.argv.includes('--mode-low-budget');
const restart = restartScenario || restartCompleteScenario;
const safetyScenario = captureScenario || nestedCapture || smallViewportScenario || restart || modeScenario || modeBudgetScenario || budgetScenario;
if([inputScenario,submitScenario,captureScenario,mapCaptureScenario,auditCaptureScenario,forcedCaptureScenario,smallViewportScenario,restartScenario,restartCompleteScenario,modeScenario,modeBudgetScenario].filter(Boolean).length>1)throw Error('只能选择一种模拟场景');
const pngChunk=(type,data)=>{const b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(pngCrc32(b.subarray(4,8+data.length)),8+data.length);return b};
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(2,0);ihdr.writeUInt32BE(2,4);ihdr[8]=8;ihdr[9]=2;
const brightPng=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('IDAT',deflateSync(Buffer.from([0,110,130,150,110,130,150,0,110,130,150,110,130,150]))),pngChunk('IEND',Buffer.alloc(0))]);
function stateSnapshot(body) { const lines=body.split('\n'); return {loginBlocked:false,titleCount:1,protectedRects:[{x:0,y:0,width:120,height:60}],fields:lines.reduce((out,label,i)=>i%2===0?[...out,{label,value:lines[i+1]}]:out,[])}; }
let child, dashboard, socket, pending = null, acknowledged = false, fakeModelPid=null;
const contenders=[];
const methods = [], inputs = []; let stage=0,stageReads=0,mapCaptures=0,selected=forcedCaptureScenario||evidenceFailure==='write-forced';let listReads=0;
const target = {id:'synthetic',type:'page',url:'https://tuxun.fun/challenge/00000000-0000-4000-8000-000000000000',title:'题库经典五题 - 图寻 - 探索世界',webSocketDebuggerUrl:'ws://127.0.0.1:19365/devtools/page/synthetic'};
const mock = createServer((req,res)=>{
  if(req.url==='/json/list'){listReads++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify([target]));return}
  res.writeHead(404);res.end();
});
function frame(value) {
  const data=Buffer.from(JSON.stringify(value));
  assert.ok(data.length<65536);
  return Buffer.concat([data.length<126?Buffer.from([0x81,data.length]):Buffer.from([0x81,126,data.length>>8,data.length&255]),data]);
}
function releasePending() {
  if(!socket || socket.destroyed || socket.writableEnded || pending===null || !acknowledged)return;
  socket.write(frame(inputScenario?{id:pending,result:{}}:{id:pending,error:{message:'synthetic interruption'}}));
  pending=null;
}
mock.on('upgrade',(req,ws)=>{
  socket=ws;
  const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  ws.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  let buffer=Buffer.alloc(0);
  ws.on('error',error=>{if(!['ECONNRESET','EPIPE'].includes(error.code))throw error;});
  ws.on('data',chunk=>{
    buffer=Buffer.concat([buffer,chunk]);
    while(buffer.length>=2){
      let len=buffer[1]&127,offset=2;
      if(len===126){if(buffer.length<4)return;len=buffer.readUInt16BE(2);offset=4}
      if(len===127)throw Error('模拟请求过大');
      const masked=Boolean(buffer[1]&128),size=offset+(masked?4:0)+len;if(buffer.length<size)return;
      const mask=masked?buffer.subarray(offset,offset+4):null;offset+=masked?4:0;
      const payload=Buffer.from(buffer.subarray(offset,offset+len));if(mask)for(let i=0;i<len;i++)payload[i]^=mask[i%4];
      const opcode=buffer[0]&15;buffer=buffer.subarray(size);
      if(opcode===8){ws.end();return}if(opcode!==1)continue;
      const msg=JSON.parse(payload.toString());methods.push(msg.method);
      if(restartCompleteScenario && msg.method==='Page.enable'){
        setTimeout(()=>ws.write(frame({id:msg.id,result:{}})),2200);continue;
      }
      if(msg.method==='Input.dispatchMouseEvent')inputs.push({type:msg.params?.type,afterStop:acknowledged});
      if(failureTriggered&&msg.method.startsWith('Input.'))inputsAfterFailure.push(msg.method);
      if(auditDecision && msg.method==='Input.dispatchMouseEvent' && msg.params?.type==='mouseReleased')selected=true;
      if((!inputScenario && !submitScenario && !safetyScenario && msg.method==='Runtime.evaluate') || (inputScenario && msg.method==='Input.dispatchMouseEvent' && msg.params?.type==='mousePressed')){
        pending=msg.id;releasePending();continue;
      }
      if((submitScenario||restart) && msg.method==='Input.dispatchMouseEvent' && msg.params?.type==='mouseReleased'){stage++;stageReads=0;}
      let result={};
      if((inputScenario||submitScenario||safetyScenario) && msg.method==='Runtime.evaluate'){
        const expression=msg.params.expression;
        let body;
        if(restartCompleteScenario){
          if(stage===0)body='回合\n5 / 5\n距离\n56 km\n得分\n4,000 / 5,000\n总分\n20,000';
          else {const n=Math.min(stage,5),first=expression.includes('function snapshotVisibleState')&&stageReads++===0;body=first?`回合\n${n} / 5\n总分\n0`:`回合\n${n} / 5\n距离\n56 km\n得分\n4,000 / 5,000\n总分\n${n*4000}`;}
        }else body=restartScenario?(stage===0?'回合\n5 / 5\n距离\n56 km\n得分\n4,000 / 5,000\n总分\n20,000':'回合\n1 / 5\n总分\n0'):(stage===0?'回合\n1 / 5\n总分\n0':stage===1?'回合\n1 / 5\n距离\n56 km\n得分\n4,000 / 5,000\n总分\n4,000':'回合\n2 / 5\n总分\n4,000');
        const value=expression.includes('function snapshotVisibleState')?stateSnapshot(body):expression.includes('document.elementsFromPoint')?'confirm':{x:400,y:300};
        result={result:{value}};
        if(nestedCapture){
          const map={x:500,y:100,width:700,height:500,pins:selected?[{x:850,y:350}]:[]};
          result={result:{value:expression.includes('function snapshotVisibleState')?stateSnapshot(evidenceFailure==='write-result'?'回合\n1 / 5\n距离\n10 km\n得分\n100 / 5000\n总分\n100':'回合\n1 / 5\n总分\n0'):expression.includes('document.elementsFromPoint')?(msg.params.expression.includes('1100,700')?'confirm':'map'):expression.includes("document.querySelectorAll('.maplibregl-map')")?map:{x:1100,y:700}}};
        }
      }
      if(evidenceFailure==='bad-state'&&msg.method==='Runtime.evaluate'&&msg.params.expression.includes('function snapshotVisibleState')){result.result.value.fields.push({label:'回合',value:'2 / 5'});failureTriggered=true;}
      if((inputScenario||submitScenario||safetyScenario) && msg.method==='Page.getLayoutMetrics')result={cssVisualViewport:smallViewportScenario?{clientWidth:272,clientHeight:148}:{clientWidth:1200,clientHeight:900}};
      if((captureScenario||(restartScenario&&stage>0)) && msg.method==='Page.captureScreenshot'){ws.write(frame({id:msg.id,error:{message:'synthetic capture failure'}}));continue;}
      if(nestedCapture && msg.method==='Page.captureScreenshot'){
        const isMap=msg.params.clip?.x===500;
        if(isMap)mapCaptures++;
        if(forcedCaptureScenario || (mapCaptureScenario&&isMap) || (auditCaptureScenario&&mapCaptures===3)){
          ws.write(frame({id:msg.id,error:{message:'synthetic nested capture failure'}}));continue;
        }
        result={data:brightPng.toString('base64')};
        if(evidenceFailure==='decode-street'||(evidenceFailure==='decode-map'&&isMap)){result={data:Buffer.from('corrupted PNG').toString('base64')};failureTriggered=true;}
      }
      if((inputScenario||submitScenario||restart||budgetScenario) && msg.method==='Page.captureScreenshot')result={data:brightPng.toString('base64')};
      if(modeScenario && msg.method==='Page.captureScreenshot')result={data:brightPng.toString('base64')};
      if(inputFailure&&msg.method==='Input.dispatchMouseEvent'&&msg.params.type==='mousePressed'){
        ws.write(frame({id:msg.id,error:{message:'synthetic input acknowledgement failure'}}));continue;
      }
      if((budgetBefore&&msg.method==='Page.captureScreenshot') || (budgetRelease&&msg.method==='Input.dispatchMouseEvent'&&msg.params.type==='mousePressed') || (budgetFallback&&msg.method==='Runtime.evaluate'&&msg.params.expression.includes('document.elementsFromPoint'))){
        setTimeout(()=>{if(!ws.destroyed&&!ws.writableEnded)ws.write(frame({id:msg.id,result}));},1200);continue;
      }
      ws.write(frame({id:msg.id,result}));
    }
  });
});
try {
  {
    const port=await listenBrowserSafe(mock);
    target.webSocketDebuggerUrl=`ws://127.0.0.1:${port}/devtools/page/synthetic`;
    const file=path.join(workspace,'src','cli.mjs'),src=await readFile(file,'utf8');
    if(!src.includes('const port = 19365;'))throw Error('测试副本的调试端口定义已变化');
    const runtimeCheck = 'const runtime = verifyCurrent ? null : resolveCodexRuntime();';
    assert.ok(src.includes(runtimeCheck));
    await writeFile(file,src.replace('const port = 19365;',`const port = ${port};`)
      .replace(runtimeCheck, "const runtime = verifyCurrent ? null : {version:'simulated', executable:'offline-fixture'};"));
    if(evidenceFailure?.startsWith('write-')||evidenceFailure?.startsWith('read-')){
      const evidenceFile=path.join(workspace,'src','evidence.mjs'),evidenceSource=await readFile(evidenceFile,'utf8');
      const targets={
        'write-street':["writeFile","String(file).includes('-street-')"],
        'write-compass':["writeFile","String(file).includes('compass-')"],
        'write-map':["writeFile","String(file).includes('map-detail-')"],
        'read-map':["readFile","String(file).includes('map-detail-')"],
        'read-model':["readFile","String(file).includes('step-')"],
        'write-audit':["writeFile","String(file).includes('selection-audit-')"],
        'read-audit':["readFile","String(file).includes('selection-audit-')"],
        'write-forced':["writeFile","String(file).includes('forced-before-')"],
        'write-result':["writeFile","String(file).includes('-result-')"],
        'write-events':["appendFile","JSON.parse(args[0]).kind==='state'"]
      };
      const [op,condition]=targets[evidenceFailure],signature='try { return await fs[operation](file, ...args); }';
      assert.ok(evidenceSource.includes(signature));
      const injected=`try { if(operation===${JSON.stringify(op)} && (${condition})){process.send?.({type:'test_evidence_failure'});throw Object.assign(Error('synthetic evidence I/O failure'),{code:'EACCES'});} return await fs[operation](file, ...args); }`;
      await writeFile(evidenceFile,evidenceSource.replace(signature,injected));
    }
    if(signalScenario){
      const patched=await readFile(file,'utf8'),signature="const onControlMessage = message => {";
      assert.ok(patched.includes(signature));
      await writeFile(file,patched.replace(signature,signature+" if(message?.type==='test_signal'){process.emit(message.signal);if(process.connected)process.send({type:'stop_ack'});return;}"));
    }
    if(signalModel){
      const patched=await readFile(file,'utf8'),signature='async function callCodex(runtime, modelConfig, prompt, images, schema, timeoutMs) {';
      assert.ok(patched.includes(signature));
      const injected=`
        const fakeAbort=new AbortController();activeModelAbort=fakeAbort;
        const fake=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
        fake.on('spawn',()=>process.send({type:'fake_model',pid:fake.pid}));
        try{return await readModelProcess(fake,{timeoutMs,signal:fakeAbort.signal});}
        finally{activeModelAbort=null;}
      `;
      await writeFile(file,patched.replace(signature,signature+injected));
    }
    if(reportFailureScenario){
      const patched=await readFile(file,'utf8'),signature='const record = async obj => {';
      assert.ok(patched.includes(signature));
      await writeFile(file,patched.replace(signature,signature+' if(obj.kind==="stopped")throw Error("synthetic report write failure");'));
    }
    if(!auditDecision&&!signalModel&&!mapOnlyScenario){
      const patched=await readFile(file,'utf8'),signature="const child=spawn(runtime.executable, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });";
      assert.ok(patched.includes(signature));
      await writeFile(file,patched.replace(signature,"throw Error('离线模拟禁止启动真实模型'); const child=null;"));
    }
    if(mapOnlyScenario){
      const patched=await readFile(file,'utf8'),signature='async function callCodex(runtime, modelConfig, prompt, images, schema, timeoutMs) {';
      assert.ok(patched.includes(signature));
      const injected=`
        globalThis.syntheticCalls=(globalThis.syntheticCalls||0)+1;
        process.send?.({type:'test_model_images',images:images.map(file=>path.basename(file))});
        if(globalThis.syntheticCalls===4){process.emit('message',{type:'stop'});throw Error('synthetic complete');}
        const type=globalThis.syntheticCalls===1?'hover':globalThis.syntheticCalls===2?'return_to_street':'hover';
        return {value:{type,x:.7,y:.5,reason:'模拟观察地图',observation:'模拟可见街景',round:0},tokens:0};
      `;
      // The scoped stop controller is reached via the ordinary IPC stop handler.
      await writeFile(file,patched.replace(signature,signature+injected));
    }
    if(auditDecision){
      const patched=await readFile(file,'utf8'),signature='async function callCodex(runtime, modelConfig, prompt, images, schema, timeoutMs) {';
      assert.ok(patched.includes(signature));
      await writeFile(file,patched.replace(signature,signature+'\n  return {value:{type:"select_and_review",x:.5,y:.5,reason:"模拟地图选点",observation:"模拟可见道路",round:0},tokens:0};'));
    }
  }
  dashboard=createDashboardServer({capture:async()=>Buffer.from('synthetic'),launchWorker:args=>{
    child=fork(path.join(workspace,'src','cli.mjs'),['run',...args,...(inputScenario||submitScenario||(budgetScenario&&!budgetFallback)?['--verify-current']:[]),...(smallViewportScenario||modeBudgetScenario||forcedCaptureScenario||evidenceFailure==='write-forced'?['--initial-round-seconds','40']:[]),...(budgetScenario?['--round-seconds',inputFailure?'300':'1','--max-actions',inputFailure?'1':'35']:[])],{cwd:workspace,silent:true,windowsHide:true});
    child.on('message',message=>{if(message?.type==='test_model_images')syntheticInputs.push(message.images);if(message?.type==='test_evidence_failure')failureTriggered=true;if(message?.type==='stop_ack'){acknowledged=true;releasePending()}if(message?.type==='fake_model')fakeModelPid=message.pid;});
    return child;
  }});
  await listenBrowserSafe(dashboard);
  const base=`http://127.0.0.1:${dashboard.address().port}`;
  const html=await(await fetch(base)).text(), token=html.match(/const token='([0-9a-f]+)'/)[1];
  const headers={'x-dashboard-token':token,'content-type':'application/json',origin:base};
  const started=await fetch(`${base}/api/start`,{method:'POST',headers,body:JSON.stringify({confirm:true,mode:modeScenario||modeBudgetScenario?'move':'fixed',games:restart?2:1,roundSeconds:300,totalSeconds:restartCompleteScenario?4:1800,maxActions:35})});
  assert.equal(started.status,202);
  const status=async()=>(await(await fetch(`${base}/api/status`,{headers:{'x-dashboard-token':token}})).json());
  let state;
  for(let i=0;i<800;i++){state=await status();if(state.events.some(e=>e.kind==='started') && (signalModel?fakeModelPid!==null:submitScenario||safetyScenario?!state.running:inputScenario?inputs.some(e=>e.type==='mousePressed'):methods.includes('Runtime.evaluate')))break;await delay(25)}
  assert.ok(state.events.some(e=>e.kind==='started'),'实际 CLI 应启动');
  if(mapOnlyScenario){
    for (const event of state.events.filter(e=>['started','model_start','model_finished','model_failed'].includes(e.kind))) {
      assert.deepEqual(event.request_config,{model:'gpt-6-astra',reasoning_effort:'high'});
    }
    assert.deepEqual(syntheticInputs,[['step-000.png','compass-000.png','map-detail-000.png'],['map-detail-001.png'],['step-002.png','compass-002.png','map-detail-002.png'],['map-detail-003.png']]);
    const decisions=state.events.filter(e=>e.kind==='decision');
    assert.deepEqual(decisions.map(e=>e.screenshot),['step-000.png','map-detail-001.png','step-002.png']);
    assert.equal(decisions[1].model_image,'map-detail-001.png');
    const run=state.events.find(e=>e.kind==='started').runDir;
    for(const name of ['step-001.png','compass-001.png','step-003.png','compass-003.png'])await assert.rejects(readFile(path.join(run,name)),{code:'ENOENT'});
    for(const decision of decisions)assert.ok((await readFile(path.join(run,decision.screenshot))).length>0);
    assert.equal(methods.filter(m=>m==='Page.captureScreenshot').length,10,'四个决策步骤仅捕获四张地图、两组街景/方位和两次加载探针');
    assert.equal(state.events.some(e=>['forced_recovery','result','forced_submitted'].includes(e.kind)),false);
    assert.ok(inputs.every(e=>!e.afterStop));
  } else if(evidenceFailure){
    assert.equal(failureTriggered,true,'必须实际触发注入的故障');
    assert.equal(state.running,false);
    assert.deepEqual(inputsAfterFailure,[],'证据或页面故障后不得发送新输入');
    assert.equal(state.events.some(e=>['forced_recovery','forced_submitted','result','next_round_verified'].includes(e.kind)),false);
    assert.match(state.outcome,evidenceFailure==='bad-state'?/字段缺失或不唯一/:/运行证据不可用/);
    if(!['read-map','write-audit','read-audit','write-forced'].includes(evidenceFailure))assert.deepEqual(inputs,[]);
  } else if(budgetScenario){
    assert.deepEqual(inputs.map(e=>e.type),budgetBefore?[]:budgetFallback?['mouseMoved']:['mousePressed']);
    const stopped=state.events.findLast(e=>e.kind==='stopped');
    assert.equal(stopped.state.actions,budgetBefore?0:1,'首个输入派发即扣额，失败或超时不得退还');
    assert.match(state.outcome,inputFailure?/synthetic input acknowledgement failure/:/时间上限/);
    assert.equal(state.events.some(e=>['forced_recovery','forced_submitted','result'].includes(e.kind)),false);
  } else if(signalScenario){
    assert.equal(state.running,true);
    child.send({type:'test_signal',signal:signalName});
    for(let i=0;i<200;i++){state=await status();if(!state.running)break;await delay(25)}
    assert.equal(acknowledged,true);assert.equal(state.running,false);
    assert.match(state.outcome,/用户请求停止/);
    assert.deepEqual(inputs.map(e=>e.type),signalInput?['mousePressed']:[]);
    assert.ok(inputs.every(e=>!e.afterStop));
    for(let i=0;i<100&&child.exitCode===null;i++)await delay(20);
    assert.equal(child.exitCode,signalName==='SIGINT'?130:143);
    const run=state.events.find(e=>e.kind==='started').runDir;
    assert.match(await readFile(path.join(run,'report.md'),'utf8'),/用户请求停止/);
    if(signalModel){
      assert.ok(fakeModelPid);let alive=true;
      for(let i=0;i<100&&alive;i++){try{process.kill(fakeModelPid,0);await delay(20)}catch(e){if(e.code!=='ESRCH')throw e;alive=false;}}
      assert.equal(alive,false,'停止应终止实际的本地模拟模型子进程');
    }
  } else if(submitScenario){
    assert.deepEqual(inputs.map(e=>e.type),['mousePressed','mouseReleased','mousePressed','mouseReleased'],'模拟提交与下一题各执行一次');
    assert.equal(state.events.filter(e=>e.kind==='submit_current').length,1);
    assert.equal(state.events.find(e=>e.kind==='result')?.points,4000);
    assert.ok(state.events.some(e=>e.kind==='next_round_verified'&&e.to===2));
  } else if(restartCompleteScenario){
    assert.equal(state.outcome,'2 局完成');
    assert.equal(state.events.filter(e=>e.kind==='restart_verified').length,1);
    const first=state.events.find(e=>e.kind==='state'&&e.game===1),second=state.events.find(e=>e.kind==='state'&&e.game===2);
    assert.ok(second.start>first.start,'第二局应重置单局计时起点');
    assert.ok(Date.parse(state.events.findLast(e=>e.kind==='stopped').time)-first.start>4000,'两局总耗时应超过单局 4 秒限制');
    const results=state.events.filter(e=>e.kind==='result');
    assert.deepEqual(results.map(e=>[e.game,e.round]),[[1,5],[2,1],[2,2],[2,3],[2,4],[2,5]]);
    assert.equal(new Set(results.map(e=>e.screenshot)).size,6,'不同局的截图不能覆盖');
    assert.equal(inputs.length,10,'一次重开和四次下一题各点击一次');
  } else if(restartScenario){
    assert.deepEqual(inputs.map(e=>e.type),['mousePressed','mouseReleased'],'重开只点击一次');
    assert.equal(state.events.filter(e=>e.kind==='restart_attempt').length,1);
    assert.equal(state.events.filter(e=>e.kind==='restart_verified'&&e.game===2).length,1);
    assert.ok(state.events.some(e=>e.kind==='result'&&e.game===1&&e.round===5));
    assert.ok(state.events.some(e=>e.kind==='state'&&e.game===2&&e.round===1&&e.actions===0));
    assert.match(state.outcome,/synthetic capture failure/);
  } else if(reportFailureScenario){
    assert.equal(state.running,false,'报告写入失败也必须关闭调试连接并退出');
    assert.ok(state.lines.some(line=>line.includes('synthetic report write failure')));
    assert.deepEqual(inputs,[]);
  } else if(nestedCapture){
    assert.match(state.outcome,/synthetic nested capture failure/);
    assert.equal(state.events.some(e=>e.kind==='forced_recovery'||e.kind==='forced_submitted'||e.kind==='result'),false);
    assert.deepEqual(inputs.map(e=>e.type),auditCaptureScenario?['mousePressed','mouseReleased']:forcedCaptureScenario?['mouseMoved']:[],'截图失败后不能发出新的选点或提交输入');
    assert.equal(mapCaptures,auditCaptureScenario?3:mapCaptureScenario?1:0);
  } else if(safetyScenario){
    assert.equal(methods.includes('Page.captureScreenshot'),captureScenario||modeScenario,'截图故障与模式检查场景应调用截图');
    assert.deepEqual(inputs,[],'安全检查失败后不能选择兜底点或提交');
    assert.equal(state.events.some(event=>event.kind==='forced_recovery'),false);
    assert.match(state.outcome,modeScenario?/未检测到可见移动箭头/:modeBudgetScenario?/预算不足以确认移动模式/:captureScenario?/synthetic capture failure/:/页面尺寸过小/);
  } else {
    if(inputScenario)assert.deepEqual(inputs,[{type:'mousePressed',afterStop:false}],'停止前应有一次待确认的模拟按下');
    else assert.ok(methods.includes('Runtime.evaluate'),'CLI 应进入模拟页面读取');
    if(lockScenario){
      const other=path.join(workspace,'other-checkout');await cp(path.join(workspace,'src'),path.join(other,'src'),{recursive:true});
      for(const command of ['run','stop','headless']){
        const before=listReads;
        const contender=fork(path.join(other,'src','cli.mjs'),[command],{cwd:other,silent:true,windowsHide:true});contenders.push(contender);
        let output='';contender.stderr.setEncoding('utf8');contender.stderr.on('data',chunk=>output+=chunk);
        await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('竞争进程未退出')),5000);contender.once('close',()=>{clearTimeout(timer);resolve()});});
        assert.equal(contender.exitCode,1);assert.match(output,/已被另一运行占用/);
        assert.equal(listReads,before,'竞争进程不能读取或操作已有浏览器');
      }
    }
    assert.equal((await fetch(`${base}/api/stop`,{method:'POST',headers})).status,202);
    for(let i=0;i<200;i++){state=await status();if(!state.running)break;await delay(25)}
    assert.equal(acknowledged,true,'实际 CLI 应确认停止请求');
    assert.match(state.outcome,/用户请求停止/);
    assert.ok(inputs.every(event=>!event.afterStop),'停止后不能发送浏览器输入');
    if(inputScenario){assert.equal(inputs.length,1,'未确认的模拟输入不能被重复或释放');assert.ok(state.events.some(event=>event.kind==='submit_current'))}
  }
  assert.equal(state.running,false);
  const release=await acquireRunLock(mock.address().port);await release();
  assert.equal(state.events.filter(event=>event.kind==='model_start').length,mapOnlyScenario?4:auditDecision||signalModel||evidenceFailure==='read-model'?1:0,'只允许指定的合成决策或模拟模型进程');
  console.log(mapOnlyScenario?'地图阶段截图模拟通过：地图专用步骤不保存街景/方位，返回街景重新捕获，事件关联本步证据。':evidenceFailure?`证据故障模拟通过：${evidenceFailure}；故障后无新输入、兜底或提交。`:budgetScenario?'输入前预算模拟通过：等待、失败和半次点击均未越额继续操作。':signalScenario?'信号事件模拟通过：停止、报告保存和本地模拟进程终止；未访问游戏或真实模型。':lockScenario?'跨工作区 CLI/控制台互斥模拟通过。':restartCompleteScenario?'实际 CLI 模拟跨局并完成第二局五题：成绩及截图按局区分，未调用模型。':restartScenario?'实际 CLI 模拟完成一局并重开：按钮点击一次，新局状态已重置，未调用模型。':modeScenario||modeBudgetScenario?'实际 CLI 模拟移动模式无法确认：没有兜底选点、提交或模型调用。':safetyScenario?'实际 CLI 模拟截图失败或窗口过小后停止：没有兜底选点、提交或模型调用。':submitScenario?'实际 CLI 模拟提交、结果记录和下一题切换通过；未访问图寻或调用模型。':inputScenario?'实际 CLI 模拟输入进行中停止：停止后没有新输入，提交状态未知，未调用模型。':'实际 CLI 对接本机模拟浏览器：停止请求已确认，未发送浏览器输入，未调用模型。');
} finally {
  for(const contender of contenders)if(contender.exitCode===null&&contender.signalCode===null)contender.kill();
  if(child && child.exitCode===null){child.kill();for(let i=0;i<40&&child.exitCode===null;i++)await delay(50)}
  if(socket)socket.destroy();
  if(dashboard){dashboard.closeAllConnections();await new Promise(resolve=>dashboard.close(resolve))}
  mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));
  const resolved=await realpath(workspace).catch(()=>null);
  if((!child||child.exitCode!==null) && resolved && path.dirname(resolved)===tempRoot && path.basename(resolved).startsWith('tuxun-stop-'))await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
