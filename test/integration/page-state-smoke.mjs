// Rendered synthetic DOM only; isolated Chrome, no website or model access.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {get} from 'node:http';
import {mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {CDP} from '../../src/cdp.mjs';
import {readVisibleGameState,readGameLayout,PageStateError} from '../../src/page-state.mjs';
import {visibleMap,mapControlAt,visibleMapExpandButton,visibleButton,targetKind} from '../../src/targets.mjs';
import {decodeScreenshot} from '../../src/evidence.mjs';

const temp=await realpath(tmpdir()),profile=await mkdtemp(path.join(temp,'tuxun-fields-'));
const child=spawn(process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
  '--headless=new','--disable-gpu','--disable-extensions','--disable-sync','--disable-background-networking','--no-first-run','--no-default-browser-check',
  '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'
],{windowsHide:true,stdio:'ignore'});
let page,exited=false,error;
child.on('exit',()=>exited=true);child.on('error',e=>{error=e;exited=true});
const json=url=>new Promise((resolve,reject)=>{const req=get(url,res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>{try{resolve(JSON.parse(data))}catch(e){reject(e)}})});req.on('error',reject);req.setTimeout(2000,()=>req.destroy(Error('debug timeout')));});
let checks=0;
try {
  let port;const deadline=Date.now()+15000;
  while(!port&&!exited&&Date.now()<deadline){try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0]);}catch{await delay(100)}}
  if(!port)throw error||Error('isolated Chrome unavailable');
  const targets=await json(`http://127.0.0.1:${port}/json/list`);
  page=await CDP.connect(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  const render=async html=>{
    const r=await page.call('Runtime.evaluate',{expression:`document.body.innerHTML=${JSON.stringify('<style>body{margin:0;font:16px sans-serif}.field{display:inline-block;margin:4px;vertical-align:top}.field>*{display:block}button{padding:10px}</style>'+html)}`,returnByValue:true});
    assert.ok(!r.exceptionDetails);await delay(20);
  };
  const field=(label,value)=>`<div class="field"><span>${label}</span><strong>${value}</strong></div>`;
  const active=(name='任意题库')=>`<header>${field('题库',name)}${field('回合','1 / 5')}${field('总分','0')}</header>`;
  for(const [width,height,dpr] of [[1200,900,1],[700,800,1],[1600,1000,2]]){
    await page.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false});
    for(const name of ['登录','距离','得分','回合','总分','世界密码图集','距离 10 km','回合 4 / 5']){
      await render(active(name));
      assert.deepEqual(await readVisibleGameState(page),{round:1,score:0,result:null},`${width}: ${name}`);checks++;
    }
    // A narrower header puts metadata into the fixed compass clip: fail closed.
    assert.ok((await readGameLayout(page,{clientWidth:width,clientHeight:height})).safeHeight>=300);
    const shot=decodeScreenshot(await page.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}));
    assert.equal(shot.check.width,width*dpr);checks++;
  }
  await page.call('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false});
  await render('<div style="position:absolute;left:500px;top:0">'+active()+'</div>');
  await assert.rejects(readGameLayout(page,{clientWidth:1200,clientHeight:900}),PageStateError);checks++;
  for(const extra of ['<button>登录</button>','<dialog open>请先登录后继续</dialog>','<input type="password">',field('回合','2 / 5'),field('距离',''),field('距离','10 km'),field('总分','0')]){
    await render(active()+extra);await assert.rejects(readVisibleGameState(page),PageStateError);checks++;
  }
  for(const style of ['display:none','visibility:hidden','opacity:0','position:absolute;left:-2000px']){
    await render(active()+`<div style="${style}"><button>登录</button>${field('回合','2 / 5')}</div>`);
    assert.equal((await readVisibleGameState(page)).round,1);checks++;
  }
  await render(active()+field('距离','12.5 km')+field('得分','4,000 / 5,000'));
  assert.equal((await readVisibleGameState(page)).result.points,4000);checks++;
  await render('<div class="field">回合 1 / 5</div><div class="field">总分：0</div>');
  assert.equal((await readVisibleGameState(page)).score,0);checks++;
  await render('<div class="field"><span>回合</span><span>1 / 50</span></div>');
  await assert.rejects(readVisibleGameState(page),PageStateError);checks++;
  const map='<div class="maplibregl-map" style="position:absolute;left:500px;top:200px;width:500px;height:400px;background:green"></div>';
  await render(active()+map+'<div class="mapControl" style="position:absolute;top:120px;left:500px"><button>缩小地图窗口</button><button>扩大地图窗口</button><button>?</button></div>');
  const expand=await visibleMapExpandButton(page);assert.ok(expand);
  assert.equal(await mapControlAt(page,expand.x,expand.y),'扩大地图窗口');
  assert.equal((await visibleMap(page)).width,500);checks++;
  await render(active()+map+map.replace('left:500px','left:0px'));
  assert.equal(await visibleMap(page),null);checks++;
  await render(active()+map+'<div style="position:absolute;inset:0;background:white">遮罩</div>');
  assert.equal(await visibleMap(page),null);checks++;
  await render(active()+'<div class="mapControl"><button>?</button><button>?</button><button>?</button></div>');
  assert.equal(await visibleMapExpandButton(page),null);checks++;
  await render(active()+map.replace('</div>','<div style="opacity:0"><div class="maplibregl-marker" style="width:20px;height:20px"></div></div></div>'));
  assert.equal((await visibleMap(page)).pins.length,0);checks++;
  await render(active()+'<div style="opacity:0"><button>下一轮</button></div>');
  assert.equal(await visibleButton(page,'下一轮'),null);checks++;
  await render(active()+'<div class="mapControl" style="position:absolute;left:500px;top:100px"><button disabled style="width:100px;height:50px">扩大地图窗口</button></div>');
  assert.equal(await targetKind(page,550,125),'unknown');checks++;
  await render('<div class="field"><span>回合</span><span style="opacity:0">1 / 5</span></div>');
  await assert.rejects(readVisibleGameState(page),PageStateError);checks++;
  console.log(`可见页面合成验证通过：${checks} 项，三个视口／像素密度；未访问游戏或模型。`);
} finally {
  if(page){await page.call('Browser.close',{},2000).catch(()=>{});page.close();}
  if(!exited)child.kill();
  for(let i=0;i<60&&!exited;i++)await delay(50);
  const resolved=await realpath(profile);
  if(exited&&path.dirname(resolved)===temp&&path.basename(resolved).startsWith('tuxun-fields-'))await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
