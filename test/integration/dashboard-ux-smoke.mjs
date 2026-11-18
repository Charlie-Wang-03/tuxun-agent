// Browser acceptance with a synthetic in-memory worker and generated local preview.
// No game, login profile, Codex subprocess, or external network is used.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import http from 'node:http';
import {mkdtemp,readFile,writeFile,mkdir,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {CDP} from '../../src/cdp.mjs';
import {createDashboardServer} from '../../src/dashboard-server.mjs';
import {listenBrowserSafe} from '../../src/browser-port.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)), tempRoot=await realpath(tmpdir());
const profile=await mkdtemp(path.join(tempRoot,'tuxun-ux-'));
const output=path.join(root,'artifacts','ui-acceptance',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(output,{recursive:true});
const child=spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--disable-gpu','--disable-extensions','--disable-sync','--disable-background-networking','--no-first-run','--no-default-browser-check',
  '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1440,1000','about:blank'
],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let exited=false,launchError=null,stderr='',page,browser,server,worker,captureBroken=true,failStop=true,failLaunch=false,launches=0,actualArgs;
child.on('exit',()=>{exited=true;});child.on('error',e=>{launchError=e;exited=true;});child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000);});
const checks=[],layoutChecks=[];
// Dimensions are CSS viewport pixels; deviceScaleFactor controls pixel density, not browser zoom.
const desktopViewports=[[1000,700,1],[1024,768,1],[1280,720,1],[1366,650,1],[1366,768,1],[1440,900,1],[1536,864,1],[1920,1080,1],[2560,1440,1],[3840,2160,1],[1920,1080,2]];
const reflowViewports=[[999,768,1],[768,1024,1],[390,844,1],[320,740,1],[1280,600,1],[853,480,1]];
// Chrome chooses its own ephemeral debugging port, which can be Fetch-blocked.
// Native HTTP is used only for this isolated Chrome's loopback discovery endpoints.
function debugJSON(url) {
  return new Promise((resolve,reject)=>{
    const req=http.get(url,res=>{
      let data='';res.setEncoding('utf8');res.on('data',chunk=>{data+=chunk;});res.on('error',reject);
      res.on('end',()=>{try{if(res.statusCode!==200)throw Error(`调试接口 HTTP ${res.statusCode}`);resolve(JSON.parse(data));}catch(e){reject(e);}});
    });
    req.on('error',reject);req.setTimeout(3000,()=>req.destroy(Error('调试接口超时')));
  });
}
try {
  let port;const deadline=Date.now()+15000;
  while(Date.now()<deadline&&!port&&!exited){try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0]);}catch{await delay(100);}}
  if(!port)throw Error(`Chrome 未启动：${launchError?.message || stderr}`);
  const base=`http://127.0.0.1:${port}`;
  const targets=await debugJSON(base+'/json/list');page=await CDP.connect(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  const runtimeErrors=[];
  page.ws.addEventListener('message',e=>{const message=JSON.parse(e.data);if(message.method==='Runtime.exceptionThrown')runtimeErrors.push(message.params.exceptionDetails.text);});
  await page.call('Runtime.enable');
  const evaluate=async expression=>{const r=await page.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);return r.result.value;};
  const wait=async(expression,message,timeout=8000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(expression))return;await delay(100);}throw Error(`等待失败：${message}\n${await evaluate("document.body.innerText")}`);};
  const capture=async name=>{await delay(150);const shot=await page.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(output,name+'.png'),Buffer.from(shot.data,'base64'));};
  const viewport=async(width,height,deviceScaleFactor=1)=>page.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor,mobile:false});
  const select=async(id,value)=>evaluate(`(()=>{const n=document.getElementById(${JSON.stringify(id)}),target=${JSON.stringify(value)};for(let i=0;i<3&&n.dataset.value!==target;i++)n.click();if(n.dataset.value!==target)throw Error('Preference button did not reach '+target);})()`);
  const click=async id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  const singleScreen=async(label,selectors)=>{
    const layout=await evaluate(`(()=>{const selectors=${JSON.stringify(selectors)};return {page:document.documentElement.scrollHeight<=innerHeight,items:selectors.map(s=>{const n=document.querySelector(s),r=n.getBoundingClientRect();return {selector:s,visible:r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,overflow:n.scrollHeight-n.clientHeight};})};})()`);
    assert.ok(layout.page,`${label} 页面应在一屏内：${JSON.stringify(layout)}`);
    for(const item of layout.items)assert.ok(item.visible,`${label} ${JSON.stringify(item)} 完整可见`);
    return layout;
  };
  const verifyLayouts=async(scene,selectors)=>{
    const preserved=await evaluate("({games:document.querySelector('#games').value,round:document.querySelector('#round').value,total:document.querySelector('#total').value,ready:document.querySelector('#manualReady').checked,authorized:document.querySelector('#authorize').checked,position:document.querySelector('#replayPosition').value,observation:document.querySelector('#observation').textContent})");
    for(const language of ['zh','en'])for(const theme of ['light','dark']) {
    await select('languageToggle',language);await select('themeToggle',theme);
    for(const [width,height,dpr] of [...desktopViewports,...reflowViewports]){
      await viewport(width,height,dpr);await evaluate('window.scrollTo(0,0)');
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),`${scene} ${width}×${height} 不应横向溢出`);
      const desktop=width>=1000&&height>=640;
      if(desktop){
        const layout=await singleScreen(`${scene} ${width}×${height} @${dpr}`,selectors);
        if(scene==='prepare'){if(layout.items[0].overflow>1)await capture('failure-layout');assert.ok(layout.items[0].overflow<=1,`准备表单无需内部滚动：${language} ${theme} ${width}×${height} ${layout.items[0].overflow}`);}
        const overlap=await evaluate(`(()=>{const rects=${JSON.stringify(selectors)}.map(s=>({s,r:document.querySelector(s).getBoundingClientRect()}));return rects.flatMap((a,i)=>rects.slice(i+1).filter(b=>Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left)>1&&Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top)>1).map(b=>a.s+' / '+b.s));})()`);
        assert.deepEqual(overlap,[],`${scene} 主区域不能重叠`);
      }
      const clippedControls=await evaluate("[...document.querySelectorAll('button,input,select')].filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&(r.left<0||r.right>innerWidth+1)}).map(n=>n.id)");
      assert.deepEqual(clippedControls,[],`${scene} ${width}×${height} 控件不应横向裁切`);
      layoutChecks.push({scene,language,theme,width,height,deviceScaleFactor:dpr,layout:desktop?'single-screen':'vertical-reflow'});
      if((width===1366&&height===650)||width===320)await capture(`matrix-${scene}-${language}-${theme}-${width}-${height}-${dpr}x`);
    }
    }
    await select('languageToggle','zh');await select('themeToggle','light');
    const after=await evaluate("({games:document.querySelector('#games').value,round:document.querySelector('#round').value,total:document.querySelector('#total').value,ready:document.querySelector('#manualReady').checked,authorized:document.querySelector('#authorize').checked,position:document.querySelector('#replayPosition').value,observation:document.querySelector('#observation').textContent})");
    assert.deepEqual(after,preserved,'切换语言和主题不得丢失表单、确认、回放位置或原始观察');
    await viewport(1366,650);await evaluate('window.scrollTo(0,0)');
  };
  const fill=async(id,value)=>evaluate(`(()=>{const n=document.getElementById(${JSON.stringify(id)});n.value=${JSON.stringify(String(value))};n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const previewData=await evaluate(`(()=>{const c=document.createElement('canvas');c.width=1280;c.height=720;const x=c.getContext('2d');x.fillStyle='#627c81';x.fillRect(0,0,1280,720);x.fillStyle='#425c4c';x.beginPath();x.moveTo(0,360);x.lineTo(200,180);x.lineTo(580,420);x.lineTo(900,210);x.lineTo(1280,410);x.lineTo(1280,720);x.lineTo(0,720);x.fill();x.fillStyle='#777c72';x.beginPath();x.moveTo(590,380);x.lineTo(670,380);x.lineTo(1100,720);x.lineTo(200,720);x.fill();x.strokeStyle='#e6d9a0';x.lineWidth=6;x.setLineDash([30,24]);x.beginPath();x.moveTo(630,400);x.lineTo(645,720);x.stroke();x.fillStyle='#17201c';x.fillRect(24,24,380,62);x.fillStyle='#edf1f2';x.font='24px sans-serif';x.fillText('本地模拟画面 · 非真实游戏',44,64);return c.toDataURL('image/jpeg').split(',')[1];})()`);
  const jpeg=Buffer.from(previewData,'base64');
  const send=event=>worker.emit('message',{type:'event',event:{time:new Date().toISOString(),game:1,...event}});
  server=createDashboardServer({readEvents:async()=>'{"kind":"synthetic_full_log"}\n',capture:async()=>{if(captureBroken)throw Error('模拟截图服务中断');return jpeg;},launchWorker:args=>{
    actualArgs=args;launches++;worker=new EventEmitter();worker.stdout=new PassThrough();worker.stderr=new PassThrough();worker.connected=true;
    worker.send=(_message,callback)=>{
      if(failStop){setImmediate(()=>callback(Error('模拟停止通道中断')));return false;}
      callback(null);setTimeout(()=>send({kind:'stopped',reason:'模拟停止；提交状态未知'}),250);
      setTimeout(()=>{worker.connected=false;worker.emit('close',0,null);},900);return true;
    };
    if(failLaunch){setTimeout(()=>{worker.emit('error',Error('模拟无法启动进程'));worker.emit('close',1,null);},80);return worker;}
    setTimeout(()=>{
      const now=Date.now();send({kind:'started',mode:'fixed-view',limits:{games:2,roundSeconds:300,totalSeconds:1800,maxActions:35}});
      send({kind:'result',round:1,points:3400,score:3400,forced:false});
      send({kind:'state',round:2,score:3400,actions:12,start:now-200000,roundStart:now-162000,roundLimit:300,actionLimit:35});
      send({kind:'decision',action:{type:'map_select',observation:'模拟观察：路面、山坡与道路走向。',reason:'根据已记录线索查看地图区域。'}});
      send({kind:'action_executed',round:2,type:'map_select',target:'map'});
      send({kind:'selection_audit',round:2,verdict:'uncertain',reason:'模拟核对：图钉附近缺少可辨认的地名。'});
      send({kind:'model_start',label:'核对地图选点'});worker.stdout.write('模拟运行日志\n');
    },80);return worker;
  }});
  await listenBrowserSafe(server);const url=`http://127.0.0.1:${server.address().port}/`;
  await page.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
  await page.call('Page.navigate',{url});await viewport(1440,900);
  await viewport(1366,650);
  await wait("document.querySelector('#main')?.dataset.scene==='prepare' && document.querySelector('#frameStatus').textContent.includes('模拟截图服务中断')",'未开局准备页');
  await singleScreen('未开局准备页',['#setup','.preview-panel','#readinessSummary','#start']);
  assert.equal(await evaluate("document.querySelectorAll('.preferences select').length"),0,'偏好不再使用下拉框');
  await click('languageToggle');assert.equal(await evaluate('document.documentElement.lang'),'en','语言按钮单击切换');
  await page.call('Emulation.setFocusEmulationEnabled',{enabled:true});
  await evaluate("document.querySelector('#languageToggle').focus()");
  await page.call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await page.call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  assert.equal(await evaluate('document.documentElement.lang'),'zh-CN','语言按钮支持空格键');
  await evaluate("document.querySelector('#themeToggle').focus()");
  await page.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});
  await page.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  assert.equal(await evaluate("document.querySelector('#themeToggle').dataset.value"),'light');
  await click('themeToggle');assert.equal(await evaluate("document.querySelector('#themeToggle').dataset.value"),'dark');
  await click('themeToggle');assert.equal(await evaluate("document.querySelector('#themeToggle').dataset.value"),'system');
  assert.equal(await evaluate("document.querySelector('#themeToggle svg:not([hidden])').dataset.mode"),'system');
  assert.match(await evaluate("document.querySelector('#themeToggle').getAttribute('aria-label')"),/跟随系统.*亮色/);
  assert.equal(await evaluate("document.querySelector('#round').value"),'5');
  assert.equal(await evaluate("document.querySelector('#total').value"),'30');
  await evaluate("(()=>{const n=document.querySelector('#round');n.stepUp();n.dispatchEvent(new Event('input',{bubbles:true}));})()");
  assert.equal(await evaluate("document.querySelector('#round').value"),'6');await fill('round',5);
  await page.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
  await wait("document.documentElement.dataset.theme==='dark'",'系统变暗');
  await select('themeToggle','light');
  await page.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
  await page.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'light','显式亮色不跟随系统');
  await select('themeToggle','system');await wait("document.documentElement.dataset.theme==='dark'",'重新跟随系统');
  await page.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
  await wait("document.documentElement.dataset.theme==='light'",'系统变亮');
  await select('languageToggle','en');await select('themeToggle','dark');
  assert.equal(await evaluate('document.documentElement.lang'),'en');
  assert.equal(await evaluate("document.querySelector('#setupTitle').textContent"),'Run configuration');
  await page.call('Page.reload');
  await wait("document.querySelector('#themeToggle')?.dataset.value==='dark' && document.querySelector('#setupTitle').textContent==='Run configuration'",'语言主题刷新后保留');
  assert.equal(await evaluate('getComputedStyle(document.documentElement).colorScheme'),'dark');
  await select('languageToggle','zh');await select('themeToggle','light');
  await wait("document.querySelector('#main')?.dataset.scene==='prepare'",'恢复准备页');
  await capture('00-atlas-empty-laptop');
  assert.equal(await evaluate("document.querySelector('#checkValue1').textContent"),'等待画面');
  await verifyLayouts('prepare',['#setup','.welcome-title','.preview-panel','#readinessSummary']);
  captureBroken=false;
  await wait("document.querySelector('#previewReady')?.textContent.includes('已取得')",'准备完成');
  await page.call('Emulation.setFocusEmulationEnabled',{enabled:true});
  await evaluate("document.querySelector('#replayTab').focus()");
  assert.equal(await evaluate('document.activeElement.id'),'replayTab');
  await page.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});
  await page.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  assert.equal(await evaluate("document.querySelector('#replaySetup').hidden"),false,'键盘 Enter 可进入复盘');
  await verifyLayouts('replay-empty',['#replaySetup','.welcome-title','.preview-panel','#readinessSummary']);
  await click('runTab');await wait("document.querySelector('#previewReady').textContent.includes('已取得')",'返回运行准备');
  assert.equal(await evaluate("document.querySelector('#checkValue1').textContent"),'已取得最新画面');
  assert.equal(await evaluate("document.querySelector('#start').disabled"),true);
  assert.equal(await evaluate("document.querySelector('#replaySetup').hidden"),true);
  assert.deepEqual(await evaluate("(()=>{const ids=[...document.querySelectorAll('[id]')].map(n=>n.id);return ids.filter((id,i)=>ids.indexOf(id)!==i);})()"),[],'页面元素 ID 唯一');
  for(const [width,height] of [[1440,900],[1366,768],[1366,650]]){
    await viewport(width,height);
    await capture(`00-preparation-${width}-${height}`);
    const layout=await singleScreen(`准备 ${width}×${height}`,['#setup','.preview-panel','#readinessSummary','#start']);
    assert.ok(layout.items[0].overflow<=1,`准备表单无需内部滚动：${JSON.stringify(layout)}`);
  }
  await capture('01-preparation-laptop');
  await evaluate("document.querySelector('#advancedButton').focus()");await click('advancedButton');assert.equal(await evaluate("document.querySelector('#advancedDialog').open"),true);
  await select('languageToggle','en');await select('themeToggle','dark');
  assert.match(await evaluate("document.querySelector('#advancedDialog').textContent"),/Action budget/);
  await singleScreen('操作预算弹窗',['#advancedDialog']);
  await select('languageToggle','zh');await select('themeToggle','light');
  await page.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await page.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  assert.equal(await evaluate("document.querySelector('#advancedDialog').open"),false);
  assert.equal(await evaluate('document.activeElement.id'),'advancedButton');
  await click('manualReady');await click('authorize');await click('advancedButton');await fill('actions',36);assert.equal(await evaluate("document.querySelector('#authorize').checked"),false);assert.equal(await evaluate("document.querySelector('#checkValue3').textContent"),'待确认');await fill('actions',35);await click('closeAdvanced');
  await click('manualReady');await click('authorize');assert.equal(await evaluate("document.querySelector('#start').disabled"),false);
  assert.equal(await evaluate("document.querySelector('#checkValue2').textContent"),'已人工确认');
  assert.equal(await evaluate("document.querySelector('#checkValue3').textContent"),'已确认');
  await fill('round',0.5);assert.equal(await evaluate("document.querySelector('#start').disabled"),true);
  await fill('round',0);assert.equal(await evaluate("document.querySelector('#start').disabled"),true);
  assert.equal(await evaluate("document.querySelector('#authorize').checked"),false);
  await fill('round',5);await fill('games',2);
  await evaluate("document.querySelector('input[value=\"fixed-view\"]').click()");
  await click('manualReady');await click('authorize');await click('start');await click('start');
  await wait("document.querySelector('#phase').textContent==='核对地图选点'",'运行开始');
  assert.equal(launches,1,'连续启动不能创建多个运行');assert.ok(actualArgs.includes('fixed-view'));assert.equal(actualArgs[actualArgs.indexOf('--round-seconds')+1],'300');assert.equal(actualArgs[actualArgs.indexOf('--total-seconds')+1],'1800');
  assert.equal(await evaluate("document.querySelector('#setup').hidden"),true);
  assert.equal(await evaluate("document.querySelector('#replayFiles').disabled"),true);
  assert.match(await evaluate("document.querySelector('#observation').textContent"),/模拟观察/);
  assert.match(await evaluate("document.querySelector('#actionResult').textContent"),/已执行/);
  assert.match(await evaluate("document.querySelector('#auditStatus').textContent"),/不确定/);
  assert.match(await evaluate("document.querySelector('#runningConfig').textContent"),/固定视角.*2 局/);
  await verifyLayouts('running',['.metrics','.preview-panel','#inspector','.route-board']);
  await capture('02-running-desktop');
  await click('logsButton');await select('languageToggle','en');await select('themeToggle','dark');await singleScreen('探索记录弹窗',['#logsDialog']);assert.match(await evaluate("document.querySelector('#logsDialog').textContent"),/Usage, status and raw records/);await select('languageToggle','zh');await select('themeToggle','light');await click('loadFullLog');await wait("document.querySelector('#fullLog').textContent.includes('synthetic_full_log')",'完整日志载入');await click('closeLogs');
  checks.push('准备确认、无效预算、模式、重复启动保护、结构化观察与反馈');
  for(const [width,height,name] of [[1366,650,'03-running-laptop-compact'],[1366,768,'03-running-laptop'],[390,844,'04-running-mobile'],[320,740,'05-running-small']]){
    await viewport(width,height);await evaluate('window.scrollTo(0,0)');
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'页面不能横向溢出');
    for(const id of ['stop','roundValue','budget','actionBudget','gameBudget',...(width<=760?['phaseOverview']:['phase'])])assert.ok(await evaluate(`(()=>{const r=document.querySelector('#${id}').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;})()`),`${id} 在 ${width} 宽首屏可见`);
    if(width>=1000)await singleScreen(`运行 ${width}×${height}`,['.preview-panel','#inspector','.route-board']);
    await capture(name);
  }
  await evaluate('window.scrollTo(0,document.body.scrollHeight)');
  assert.ok(await evaluate("document.querySelector('#stop').getBoundingClientRect().top>=0"),'停止按钮滚动时仍可见');
  await viewport(1440,900);await evaluate('window.scrollTo(0,0)');checks.push('1440×900 / 1366×768 / 1366×650 单屏工作台、390 / 320 移动布局、预算首屏、停止固定位置、弹窗键盘关闭');
  // Simulate a polling failure without changing or stopping the worker.
  await evaluate("window.__originalFetch=window.fetch;window.__offline=true;window.fetch=(url,opts)=>window.__offline&&url==='/api/status'?Promise.reject(Error('模拟断连')):window.__originalFetch(url,opts)");
  await wait("document.querySelector('#status').textContent.includes('状态未知')",'断连提示');
  assert.equal(await evaluate("document.querySelector('#budget').textContent"),'未知');
  assert.equal(await evaluate("document.querySelector('#stop').disabled"),false);
  assert.equal(await evaluate("document.querySelector('#start').disabled"),true);
  await viewport(1366,650);await singleScreen('断连提示',['#connectionWarning','.preview-panel','#inspector','.route-board']);
  await capture('06-disconnected');await evaluate('window.__offline=false');
  await wait("document.querySelector('#status').textContent==='运行中'",'自动重连');checks.push('断连保留状态并标记未知、禁用启动、保留停止、自动重连');
  captureBroken=true;await wait("document.querySelector('#frameStatus').textContent.includes('当前为旧画面')",'过期画面提示');
  assert.equal(await evaluate("document.querySelector('#frame').hidden"),false);
  await capture('07-stale-preview');captureBroken=false;
  await wait("document.querySelector('#frameStatus').textContent.includes('实时预览')",'预览恢复');checks.push('截图中断显示画面年龄与旧画面标签、恢复更新');
  await click('stop');await wait("document.querySelector('#status').textContent==='停止请求失败'",'停止失败');
  assert.equal(await evaluate("document.querySelector('#stop').disabled"),false);
  await capture('08-stop-retry');failStop=false;await click('stop');
  await wait("document.querySelector('#status').textContent==='正在停止'",'停止处理中');
  assert.match(await evaluate("document.querySelector('#stopNotice').textContent"),/已发出的操作/);
  await capture('09-stopping');
  await wait("document.querySelector('#status').textContent==='已结束'",'确认进程结束');
  assert.equal(await evaluate("document.querySelector('#endPanel').hidden"),false);await singleScreen('运行结束',['#endPanel','.preview-panel','#inspector','.route-board']);await verifyLayouts('ended',['#endPanel','.preview-panel','#inspector','.route-board']);await capture('10-ended');checks.push('停止失败可重试、处理中不宣称已停止、结束摘要');
  const demo=path.join(profile,'demo');await mkdir(demo);await writeFile(path.join(demo,'step.jpg'),jpeg);
  const t='2026-11-11T00:00:';
  const rows=[
    {kind:'started',time:t+'00Z',mode:'fixed-view',limits:{games:2}},
    {kind:'state',time:t+'01Z',game:1,round:1,score:0},
    {kind:'decision',time:t+'02Z',action:{type:'map_select',observation:'模拟路标 <img src=x onerror=alert(1)>',reason:'模拟选点'},screenshot:'step.jpg'},
    {kind:'model_start',label:'选点'},
    {kind:'model_finished',label:'选点',tokens:12,usage:{input_tokens:10,cached_input_tokens:0,output_tokens:2}},
    {kind:'selection_audit',verdict:'uncertain',reason:'没有足够地名'},
    {kind:'forced_mode',trigger:'模拟模型超时'},
    {kind:'result',time:t+'21Z',round:1,score:0,points:0,distance:'100 km',forced:true,forced_detail:{trigger:'模拟模型超时'},screenshot:'missing.jpg'},
    {kind:'next_round_verified',from:1,to:2},
    {kind:'state',game:1,round:2,time:t+'22Z'},
    {kind:'decision',action:{type:'hover',observation:'第二题模拟观察'},screenshot:'step.jpg'},
    {kind:'model_start',label:'未完成调用'},
    {kind:'restart_verified',from:1,to:2,game:2},
    {kind:'state',game:2,round:1},
    {kind:'model_finished',tokens:3},
    {kind:'stopped',reason:'模拟结束'}
  ];
  await writeFile(path.join(demo,'events.jsonl'),rows.map(e=>JSON.stringify(e)).join('\n')+'\n{"kind":');
  await writeFile(path.join(demo,'replay-meta.json'),JSON.stringify({schema_version:1,source:'simulated',editing:'none'}));
  await click('openReview');
  const choose=async folder=>{const doc=await page.call('DOM.getDocument');const input=await page.call('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#replayFiles'});await page.call('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[folder]});};
  await choose(demo);await wait("document.querySelector('#replayLoadStatus').textContent.includes('16 个事件')",'回放载入');
  assert.match(await evaluate("document.querySelector('#provenance').textContent"),/模拟（文件声明）.*未经编辑.*末行不完整/);
  await fill('replayPosition',3);await wait("!document.querySelector('#frame').hidden",'关联截图');
  assert.equal(await evaluate("document.querySelector('#observation img')===null"),true,'日志内容只能作为文本');
  assert.match(await evaluate("document.querySelector('#roundReview').textContent"),/0 \/ 5000.*20 秒.*12.*模型超时/);
  await viewport(1366,650);await singleScreen('复盘笔记本',['.preview-panel','#inspector','.playback-deck','.replay-heading']);
  await verifyLayouts('replay',['.replay-heading','.preview-panel','#inspector','.playback-deck']);
  await capture('11-replay-desktop');
  await click('roundTab');assert.equal(await evaluate("document.querySelector('#roundPane').hidden"),false);await capture('11-replay-summary');
  await click('runTab');await click('replayTab');await wait("!document.querySelector('#frame').hidden",'返回复盘恢复截图');
  await click('eventsTab');await evaluate("document.querySelector('#timeline button[data-index=\"7\"]').click()");
  assert.equal(await evaluate("document.querySelector('#frame').hidden"),true);
  assert.match(await evaluate("document.querySelector('#frameStatus').textContent"),/当前截图缺失/);
  await evaluate("document.querySelectorAll('#roundNav button')[1].click()");
  assert.equal(await evaluate("document.querySelector('#frame').hidden"),true,'新题不继承上一题截图');
  assert.match(await evaluate("document.querySelector('#roundReview').textContent"),/得分 未记录.*未知/);
  await fill('replayPosition',11);assert.equal(await evaluate("document.querySelector('#frame').hidden"),false);
  await viewport(390,844);await capture('12-replay-mobile');
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await viewport(1440,900);
  await evaluate("(()=>{const n=document.querySelector('#replayGame');n.value='2';n.dispatchEvent(new Event('change'));})()");
  assert.match(await evaluate("document.querySelector('#roundValue').textContent"),/第 2/);
  assert.equal(await evaluate("document.querySelector('#frame').hidden"),true);
  await fill('replayPosition',16);assert.match(await evaluate("document.querySelector('#tokens').textContent"),/口径混合/);
  await fill('replayPosition',5);assert.equal(await evaluate("document.querySelector('#tokens').textContent"),'12');
  await fill('replayPosition',12);assert.equal(await evaluate("document.querySelector('#tokens').textContent"),'12（部分未知）');
  await click('replayPause');await wait("document.querySelector('#outcome').textContent==='回放完成'",'播放完成');
  assert.equal(launches,1,'回放不得启动真实运行');checks.push('来源声明、截断日志、按题/局跳转、事件截图、缺图、零分/未知、混合用量、播放完成、文本转义');
  await evaluate("fetch('/api/start',{method:'POST',headers:{'x-dashboard-token':token,'content-type':'application/json'},body:JSON.stringify({confirm:true,mode:'fixed',games:1,roundSeconds:300,totalSeconds:1800,maxActions:35})}).then(r=>{if(!r.ok)throw Error('模拟外部启动失败');})");
  await wait("document.querySelector('#status').textContent==='离线复盘 · 另有运行'",'回放时发现另一真实运行');
  assert.equal(await evaluate("document.querySelector('#stop').disabled"),false);
  assert.equal(await evaluate("document.querySelector('#replayFiles').disabled"),true);
  assert.equal(await evaluate("document.querySelector('#outcome').textContent"),'回放完成','外部运行不覆盖当前回放内容');
  await click('stop');await wait("document.querySelector('#status').textContent==='离线复盘'",'从复盘停止另一运行');
  checks.push('复盘中发现另一运行时保留回放、锁定导入并提供真实运行停止入口');
  // Large synthetic replay: bounded DOM/log work and lossless access to the source.
  const large=path.join(profile,'large-replay');await mkdir(large);
  const largeEvents=Array.from({length:50000},(_,i)=>({kind:'decision',game:1,round:1,action:{type:'map_scroll',observation:`合成事件${i}`+'道'.repeat(100),reason:'本地性能测试'},screenshot:'missing.png'}));
  const largeText='\uFEFF'+largeEvents.map(e=>JSON.stringify(e)).join('\n')+'\n{"kind":';
  await writeFile(path.join(large,'events.jsonl'),largeText);
  const replayLoadStart=performance.now();await choose(large);await wait("document.querySelector('#replayLoadStatus').textContent.includes('50000 个事件')",'长回放载入');
  const replayLoadMs=performance.now()-replayLoadStart;
  await evaluate("window.__logChanges=0;window.__logObserver=new MutationObserver(()=>window.__logChanges++);window.__logObserver.observe(document.querySelector('#log'),{childList:true,subtree:true,characterData:true})");
  const seekMs=[];
  for(const position of [25000,50000,1,40000,49999]){const start=performance.now();await fill('replayPosition',position);seekMs.push(performance.now()-start);assert.ok(await evaluate("document.querySelectorAll('#timeline button').length<=120"));}
  assert.equal(await evaluate('window.__logChanges'),0,'关闭日志弹窗时跳转不得序列化或重写日志');
  await click('logsButton');
  const preview=await evaluate("document.querySelector('#log').textContent");
  assert.equal(preview.split('\n').length,120);assert.ok(preview.includes('合成事件49998'));assert.ok(!preview.includes('合成事件0"'));
  const downloads=path.join(profile,'downloads');await mkdir(downloads);
  await page.call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  await click('downloadReplayLog');
  let downloaded;
  for(let i=0;i<100&&!downloaded;i++){try{downloaded=await readFile(path.join(downloads,'events.jsonl'));}catch{await delay(50);}}
  assert.deepEqual(downloaded,Buffer.from(largeText),'原始日志下载逐字节保留 BOM 和截断尾行');
  await fill('replayPosition',2);assert.equal((await evaluate("document.querySelector('#log').textContent")).split('\n').length,2,'向后跳转不残留未来日志');
  await select('languageToggle','en');assert.match(await evaluate("document.querySelector('#logHint').textContent"),/120.*4000/);await select('languageToggle','zh');await click('closeLogs');
  await evaluate('window.__logObserver.disconnect()');
  await writeFile(path.join(output,'replay-performance.json'),JSON.stringify({events:50000,bytes:Buffer.byteLength(largeText),replayLoadMs,seekMs,scope:'isolated browser synthetic replay; includes CDP test overhead'},null,2));
  checks.push('50000 事件：时间线和日志各不超过 120 条，关闭日志零更新，随机回退与完整原始文件读取');
  // Missing or invalid directories preserve the existing replay and show actionable errors.
  const invalid=path.join(profile,'invalid');await mkdir(invalid);await writeFile(path.join(invalid,'events.jsonl'),'null\n');
  await choose(invalid);await wait("document.querySelector('#actionError').textContent.includes('不是事件对象')",'无效日志提示');
  assert.equal(await evaluate("document.querySelector('#replayControls').hidden"),false);
  await click('replayExit');assert.equal(await evaluate("document.querySelector('#main').dataset.scene"),'replay-empty');
  assert.equal(await evaluate("document.querySelector('#log').textContent"),'','关闭记录后清空原始日志');
  assert.equal(await evaluate("document.querySelector('#fullLog').textContent"),'');
  assert.equal(await evaluate("document.querySelector('#tokens').textContent"),'未记录');
  assert.equal(await evaluate("document.querySelector('#roundValue').textContent"),'等待题目');
  assert.equal(await evaluate("document.querySelector('#decisionReason').textContent"),'');
  assert.equal(await evaluate("document.querySelector('#frame').hasAttribute('src')"),false);
  assert.equal(await evaluate("document.querySelectorAll('#timeline button').length"),0);
  await click('runTab');await click('replayTab');
  assert.equal(await evaluate("document.querySelector('#log').textContent"),'','空复盘页不能沿用实时日志');
  assert.equal(await evaluate("document.querySelector('#tokens').textContent"),'未记录');
  await click('runTab');await click('newRun');await wait("!document.querySelector('#setup').hidden",'新运行配置');
  assert.equal(await evaluate("document.querySelector('#authorize').checked"),false);
  await viewport(390,844);await evaluate('window.scrollTo(0,0)');await capture('13-preparation-mobile');
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));checks.push('无效记录保留上一回放、关闭记录、新运行重新核对');
  await wait("document.querySelector('#previewReady').textContent.includes('已取得')",'准备新运行预览');
  failLaunch=true;await click('manualReady');await click('authorize');await click('start');
  await wait("document.querySelector('#endTitle').textContent==='未能开始运行'",'启动失败摘要');
  assert.match(await evaluate("document.querySelector('#endReason').textContent"),/模拟无法启动进程/);
  assert.equal(await evaluate("document.querySelector('#endPanel').hidden"),false);checks.push('未收到 started 事件的进程启动失败仍显示具体原因');
  checks.push('整分钟步进与秒数提交、双语切换保留数据、主题跟随系统与手动覆盖、刷新保留偏好');
  // Contrast of actual design tokens, including secondary labels and critical states.
  const contrast=[];
  for(const theme of ['light','dark']){
    await select('themeToggle',theme);
  const colors=await evaluate("(()=>{const s=getComputedStyle(document.documentElement);return Object.fromEntries(['bg','surface','raised','text','muted','accent','ink','warning','danger'].map(k=>[k,s.getPropertyValue('--'+k).trim()]));})()");
  const lum=hex=>{const values=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return values[0]*.2126+values[1]*.7152+values[2]*.0722;};
  const pairs=[['text','bg'],['text','surface'],['muted','surface'],['muted','raised'],['ink','accent'],['warning','surface'],['danger','surface']];
  const currentContrast=pairs.map(([a,b])=>({pair:`${a}/${b}`,ratio:(Math.max(lum(colors[a]),lum(colors[b]))+.05)/(Math.min(lum(colors[a]),lum(colors[b]))+.05)}));
  for(const pair of currentContrast)assert.ok(pair.ratio>=4.5,`对比度 ${pair.pair}: ${pair.ratio}`);
    contrast.push({theme,pairs:currentContrast});
  }
  assert.equal(await evaluate("document.querySelector('#status').getAttribute('role')"),'status');
  assert.equal(await evaluate("document.querySelector('#actionError').getAttribute('role')"),'alert');
  assert.deepEqual(runtimeErrors,[],'浏览器中不应有未捕获脚本异常');
  assert.equal(layoutChecks.length,340,'五种状态完整覆盖分辨率矩阵');
  checks.push('中英双语 × 明暗主题 × 五种页面状态 × 17 种视口/像素密度：单屏、纵向重排、无横向溢出、主区域不重叠、控件不横向裁切');
  checks.push('主要文字配色对比度 ≥ 4.5:1，状态/错误可供辅助技术读取');
  await writeFile(path.join(output,'acceptance.json'),JSON.stringify({source:'simulated',checks,layoutChecks,contrast,screenshots:'本目录全部截图仅含模拟数据；不验证真实游戏或模型效果'},null,2));
  console.log(`控制台 UX 模拟验收通过：${checks.length} 组检查。截图与报告：${output}`);
  const version=await debugJSON(base+'/json/version');browser=await CDP.connect(version.webSocketDebuggerUrl);
  await browser.call('Browser.close',{},3000).catch(()=>{});browser.close();browser=null;
  for(let i=0;i<50&&!exited;i++)await delay(100);
} finally {
  if(page)page.close();if(browser)browser.close();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  if(worker){worker.stdout.destroy();worker.stderr.destroy();}
  if(!exited){child.kill();for(let i=0;i<50&&!exited;i++)await delay(100);}
  const resolved=await realpath(profile).catch(()=>null);
  if(exited&&resolved&&path.dirname(resolved)===tempRoot&&path.basename(resolved).startsWith('tuxun-ux-'))await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
