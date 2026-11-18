// Reproducible synthetic measurements; no browser, game, model or run data.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {indexReplay,replayAt,createReplayReader} from '../../src/dashboard-model.mjs';

const events=Array.from({length:50000},(_,i)=>{
  const game=Math.floor(i/5000)+1,round=Math.floor(i%5000/1000)+1;
  const base={game,round,time:new Date(1700000000000+i*1000).toISOString()};
  if(i%1000===999)return {...base,kind:'result',points:1000,score:round*1000};
  if(i%10===0)return {...base,kind:'state',score:(round-1)*1000};
  if(i%10===1)return {...base,kind:'model_start',label:'合成调用'};
  if(i%10===2)return {...base,kind:'model_finished',label:'合成调用',tokens:12,usage:{input_tokens:10,cached_input_tokens:0,output_tokens:2}};
  return {...base,kind:'decision',action:{type:'map_scroll',observation:'合成道路与可见地图。'.repeat(12),reason:'离线规模测量'},screenshot:`map-${i}.png`};
});
events[0]={kind:'started',mode:'fixed',limits:{games:10}};
const rows=indexReplay(events),measure=fn=>{const start=performance.now();fn();return performance.now()-start};
let reader;
const buildMs=measure(()=>reader=createReplayReader(rows));
const positions=Array.from({length:30},(_,i)=>rows.length-29+i),before=[],after=[];
for(const position of positions) {
  before.push(measure(()=>{replayAt(rows,position);rows.slice(0,position).map(r=>JSON.stringify(r.event)).join('\n');}));
  after.push(measure(()=>{reader.at(position);reader.log(position);reader.timeline(10,5,position);}));
}
for(const position of [1,256,12000,49999,50000])assert.deepEqual(reader.at(position),replayAt(rows,position));
const sequentialMs=measure(()=>{for(let i=1;i<=rows.length;i++)reader.at(i);});
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const result={timestamp:new Date().toISOString(),node:process.version,platform:process.platform,events:events.length,bytes:Buffer.byteLength(events.map(e=>JSON.stringify(e)).join('\n')),buildMs,sequentialMs,
  tailSteps:positions.length,beforeMedianMs:median(before),afterMedianMs:median(after),beforeMs:before,afterMs:after,
  scope:'Synthetic Node measurement: old prefix reduction + full serialization versus checkpoints + bounded log/timeline; excludes browser DOM and live games.'};
const output=new URL(`../../artifacts/replay-performance/${new Date().toISOString().replace(/[:.]/g,'-')}/`,import.meta.url);
await mkdir(output,{recursive:true});await writeFile(new URL('measurement.json',output),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,beforeMs:undefined,afterMs:undefined,output:fileURLToPath(output)},null,2));
