// Explicit opt-in smoke test: launches an isolated Chrome with a synthetic page.
// It does not open TuXun, read artifacts, or call a model.
import assert from 'node:assert/strict';
import {spawn,fork} from 'node:child_process';
import {mkdtemp,readFile,rm,realpath,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {captureFrame} from '../../src/dashboard-frame.mjs';
import {CDP} from '../../src/cdp.mjs';
import {createDashboardServer} from '../../src/dashboard-server.mjs';
import {listenBrowserSafe} from '../../src/browser-port.mjs';

const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const tempRoot = await realpath(tmpdir());
const profile = await mkdtemp(path.join(tempRoot, 'tuxun-preview-'));
const fixture = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><title>Preview fixture</title><body style="margin:0;background:rgb(180,30,30)"><h1>本地模拟页面</h1></body>');
const child = spawn(chrome, ['--headless=new','--disable-gpu','--disable-extensions','--disable-sync','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=800,600',fixture], {windowsHide:true,stdio:['ignore','ignore','pipe']});
let stderr = '', browser = null, page = null, fixturePage = null, server = null, syntheticWorker = null, exited = false, launchError = null;
let viewerChild = null, viewerProfile = null, viewerBrowser = null, viewerExited = false, viewerError = null;
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
child.on('exit', () => { exited = true; });
child.on('error',error=>{launchError=error;exited=true});
const end = Date.now() + 15000;
try {
  let port;
  while (Date.now() < end && !port && !exited) {
    try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0]); }
    catch { await delay(100); }
  }
  if (!port) throw Error(`隔离 Chrome 未启动：${launchError?.message||stderr}`);
  const base = `http://127.0.0.1:${port}`;
  let pages = [];
  while (Date.now() < end) {
    pages = (await (await fetch(`${base}/json/list`,{signal:AbortSignal.timeout(1000)})).json()).filter(t=>t.type==='page');
    if (pages.length===1 && pages[0].title==='Preview fixture') break;
    await delay(100);
  }
  assert.equal(pages.length, 1);
  assert.equal(pages[0].title, 'Preview fixture');
  const opts = {debugUrl:base,isAllowed:(url,title)=>url.startsWith('data:text/html')&&title==='Preview fixture'};
  const start = performance.now(), before = await captureFrame(opts), firstMs = performance.now()-start;
  fixturePage = await CDP.connect(pages[0].webSocketDebuggerUrl);
  await fixturePage.call('Runtime.evaluate',{expression:"document.body.style.background='rgb(20,150,40)'"});
  await delay(250);
  const next = performance.now(), after = await captureFrame(opts), secondMs = performance.now()-next;
  assert.ok(before.length > 100 && after.length > 100);
  assert.notDeepEqual(before,after,'页面变化后截图应变化');
  // Exercise the real dashboard server with injected, local-only fixtures.
  let launches = 0;
  server = createDashboardServer({
    capture:()=>captureFrame(opts),
    launchWorker:()=>{launches++;syntheticWorker=fork(fileURLToPath(new URL('../fixtures/synthetic-worker.mjs',import.meta.url)),[],{silent:true,windowsHide:true});return syntheticWorker;}
  });
  await listenBrowserSafe(server);
  viewerProfile=await mkdtemp(path.join(tempRoot,'tuxun-viewer-'));
  const dashboardUrl=`http://127.0.0.1:${server.address().port}/`;
  viewerChild=spawn(chrome,['--headless=new','--disable-gpu','--disable-extensions','--disable-sync','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${viewerProfile}`,'--window-size=1200,900',dashboardUrl],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  viewerChild.stderr.on('data',()=>{});viewerChild.on('exit',()=>{viewerExited=true});viewerChild.on('error',error=>{viewerError=error;viewerExited=true});
  let viewerPort;const viewerDeadline=Date.now()+15000;
  while(Date.now()<viewerDeadline&&!viewerPort&&!viewerExited){
    try{viewerPort=Number((await readFile(path.join(viewerProfile,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0])}catch{await delay(100)}
  }
  if(!viewerPort)throw Error(`控制台浏览器未能启动：${viewerError?.message||'未知原因'}`);
  const viewerBase=`http://127.0.0.1:${viewerPort}`;let viewerPages=[];
  while(Date.now()<viewerDeadline){
    viewerPages=(await(await fetch(`${viewerBase}/json/list`,{signal:AbortSignal.timeout(1000)})).json()).filter(t=>t.type==='page');
    if(viewerPages.length===1&&viewerPages[0].url===dashboardUrl)break;
    await delay(100);
  }
  assert.equal(viewerPages.length,1);assert.equal(viewerPages[0].url,dashboardUrl);
  page=await CDP.connect(viewerPages[0].webSocketDebuggerUrl);
  const demoDir = path.join(profile,'synthetic-run'); await mkdir(demoDir);
  await writeFile(path.join(demoDir,'step.jpg'),before);
  await writeFile(path.join(demoDir,'events.jsonl'),[
    {kind:'started',mode:'fixed'},
    {kind:'decision',round:1,screenshot:'step.jpg',action:{type:'hover',observation:'模拟道路',reason:'查看模拟地图'}},
    {kind:'result',round:1,points:1000,screenshot:'missing.jpg'},
    {kind:'stopped',reason:'模拟完成'}
  ].map(e=>JSON.stringify(e)).join('\n'));
  await writeFile(path.join(demoDir,'replay-meta.json'),JSON.stringify({schema_version:1,source:'simulated',editing:'none',recorded_at:'2026-11-11T00:00:00Z'}));
  await page.call('Page.enable');
  let ready = false;
  for(let i=0;i<60&&!ready;i++) {
    await delay(100);
    ready = (await page.call('Runtime.evaluate',{expression:"document.querySelector('#replayFiles') !== null",returnByValue:true})).result.value;
  }
  assert.ok(ready,'控制台页面应加载');
  let visible=false;
  for(let i=0;i<80;i++){
    await delay(100);
    visible=(await page.call('Runtime.evaluate',{expression:"(()=>{const i=document.querySelector('#frame');return !i.hidden&&i.complete&&i.naturalWidth>0})()",returnByValue:true})).result.value;
    if(visible)break;
  }
  assert.ok(visible,'控制台应显示真实 Chrome 的模拟页面预览');
  await fixturePage.call('Runtime.evaluate',{expression:"document.body.style.background='rgb(20,50,200)'"});
  let changed=false;
  for(let i=0;i<80;i++){
    await delay(100);
    const pixel=(await page.call('Runtime.evaluate',{expression:"(()=>{const i=document.querySelector('#frame');if(i.hidden||!i.complete||!i.naturalWidth)return null;const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext('2d');x.drawImage(i,0,0);return Array.from(x.getImageData(10,200,1,1).data)})()",returnByValue:true})).result.value;
    if(pixel&&pixel[2]>150&&pixel[0]<80&&pixel[1]<100){changed=true;break}
  }
  assert.ok(changed,'模拟页面变化应进入控制台预览');
  await page.call('Runtime.evaluate',{expression:"document.querySelector('#manualReady').click(); document.querySelector('#authorize').click(); document.querySelector('#start').click()"});
  let live;
  for(let i=0;i<80;i++) {
    await delay(100);
    live=(await page.call('Runtime.evaluate',{expression:"({status:document.querySelector('#status').textContent, round:document.querySelector('#roundValue').textContent})",returnByValue:true})).result.value;
    if(live.status==='运行中'&&live.round==='第 1 / 1 局 · 1 / 5 题')break;
  }
  assert.equal(live.status,'运行中'); assert.equal(live.round,'第 1 / 1 局 · 1 / 5 题');
  let details;
  for(let i=0;i<30;i++){
    details=(await page.call('Runtime.evaluate',{expression:"({phase:document.querySelector('#phase').textContent,audit:document.querySelector('#auditStatus').textContent,roundBudget:document.querySelector('#budget').textContent,gameBudget:document.querySelector('#gameBudget').textContent,locked:document.querySelector('input[name=mode]').disabled})",returnByValue:true})).result.value;
    if(details.phase==='模拟核对'&&details.roundBudget.includes(':')&&details.gameBudget.includes(':'))break;
    await delay(100);
  }
  assert.equal(details.phase,'模拟核对');assert.match(details.audit,/不确定/);assert.match(details.roundBudget,/:/);assert.match(details.gameBudget,/:/);assert.equal(details.locked,true);
  await page.call('Runtime.evaluate',{expression:"document.querySelector('#stop').click()"});
  for(let i=0;i<80;i++) {
    await delay(100);
    live=(await page.call('Runtime.evaluate',{expression:"({status:document.querySelector('#status').textContent, outcome:document.querySelector('#outcome').textContent})",returnByValue:true})).result.value;
    if(live.status==='已结束')break;
  }
  assert.equal(live.status,'已结束'); assert.match(live.outcome,/模拟停止/);
  assert.equal(launches,1);
  await page.call('Runtime.evaluate',{expression:"document.querySelector('#replayTab').click(); document.querySelector('#replaySpeed').value='2'"});
  const document = await page.call('DOM.getDocument');
  const input = await page.call('DOM.querySelector',{nodeId:document.root.nodeId,selector:'#replayFiles'});
  await page.call('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[demoDir]});
  for(let i=0;i<50;i++) {
    await delay(100);
    if((await page.call('Runtime.evaluate',{expression:"!document.querySelector('#replayControls').hidden && document.querySelector('#replayProgress').textContent==='1 / 4'",returnByValue:true})).result.value)break;
  }
  await page.call('Runtime.evaluate',{expression:"document.querySelector('#replayPause').click()"});
  await delay(300);
  await page.call('Runtime.evaluate',{expression:"document.querySelector('#replayPause').click()"});
  assert.equal((await page.call('Runtime.evaluate',{expression:"document.querySelector('#outcome').textContent",returnByValue:true})).result.value,'回放已暂停');
  await page.call('Runtime.evaluate',{expression:"document.querySelector('#replayPause').click()"});
  let replay;
  for(let i=0;i<60;i++) {
    await delay(100);
    replay = (await page.call('Runtime.evaluate',{expression:"({status:document.querySelector('#status').textContent, log:document.querySelector('#log').textContent, hidden:document.querySelector('#frame').hidden, frameStatus:document.querySelector('#frameStatus').textContent, outcome:document.querySelector('#outcome').textContent})",returnByValue:true})).result.value;
    if(replay.outcome==='回放完成')break;
  }
  assert.equal(replay.status,'离线复盘');
  assert.match(replay.log,/模拟道路/);
  assert.equal(replay.hidden,true,'缺失截图不能沿用之前的画面');
  assert.match(replay.frameStatus,/当前截图缺失/);
  assert.match(replay.frameStatus,/模拟（文件声明）/);
  assert.match(replay.frameStatus,/未经编辑（文件声明）/);
  assert.equal(replay.outcome,'回放完成');
  await page.call('Runtime.evaluate',{expression:"(()=>{const s=document.querySelector('#replayPosition');s.value='2';s.dispatchEvent(new Event('input'))})()"});
  const image=(await page.call('Runtime.evaluate',{expression:"({hidden:document.querySelector('#frame').hidden,status:document.querySelector('#frameStatus').textContent})",returnByValue:true})).result.value;
  assert.equal(image.hidden,false,'跳回已有截图应恢复画面');
  assert.match(image.status,/截图关联事件：decision/);
  await page.call('Runtime.evaluate',{expression:"(()=>{const s=document.querySelector('#replayPosition');s.value='1';s.dispatchEvent(new Event('input'))})()"});
  const sought=(await page.call('Runtime.evaluate',{expression:"({progress:document.querySelector('#replayProgress').textContent,outcome:document.querySelector('#outcome').textContent,log:document.querySelector('#log').textContent})",returnByValue:true})).result.value;
  assert.equal(sought.progress,'1 / 4');
  assert.equal(sought.outcome,'回放已暂停');
  assert.match(sought.log,/started/);
  assert.equal(launches,1,'回放不得启动运行');
  await page.call('Page.navigate',{url:'about:blank'});
  server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); server = null;
  page.close(); page = null;
  const viewerVersion=await(await fetch(`${viewerBase}/json/version`)).json();
  viewerBrowser=await CDP.connect(viewerVersion.webSocketDebuggerUrl);
  await viewerBrowser.call('Browser.close',{},3000).catch(()=>{});viewerBrowser.close();viewerBrowser=null;
  for(let i=0;i<60&&!viewerExited;i++)await delay(100);
  assert.ok(viewerExited,'控制台浏览器应退出');
  fixturePage.close();fixturePage=null;
  const version = await (await fetch(`${base}/json/version`)).json();
  browser = await CDP.connect(version.webSocketDebuggerUrl);
  await browser.call('Browser.close',{},3000).catch(()=>{}); browser.close(); browser = null;
  for (let i=0;i<60&&!exited;i++) await delay(100);
  assert.ok(exited,'隔离浏览器应退出');
  await assert.rejects(captureFrame(opts));
  console.log(`模拟页面预览、控制台启动/停止和浏览器回放通过：截图分别 ${Math.round(firstMs)} ms、${Math.round(secondMs)} ms；浏览器关闭后捕获失败。`);
} finally {
  if (syntheticWorker && syntheticWorker.exitCode===null) syntheticWorker.kill();
  if (server) { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
  if (page) page.close();
  if (fixturePage) fixturePage.close();
  if (viewerBrowser) viewerBrowser.close();
  if (browser) browser.close();
  if (viewerChild&&!viewerExited) { viewerChild.kill(); for(let i=0;i<50&&!viewerExited;i++) await delay(100); }
  if (!exited) { child.kill(); for(let i=0;i<50&&!exited;i++) await delay(100); }
  // Delete only the directory created by this test under the resolved OS temp root.
  const resolved = await realpath(profile).catch(()=>null);
  if (exited && resolved && path.dirname(resolved)===tempRoot && path.basename(resolved).startsWith('tuxun-preview-')) await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  const resolvedViewer=viewerProfile&&await realpath(viewerProfile).catch(()=>null);
  if(viewerExited && resolvedViewer && path.dirname(resolvedViewer)===tempRoot && path.basename(resolvedViewer).startsWith('tuxun-viewer-'))await rm(resolvedViewer,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
