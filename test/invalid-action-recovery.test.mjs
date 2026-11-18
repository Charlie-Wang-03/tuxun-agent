import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoverInvalidArrows,recoverInvalidMapHover} from '../src/invalid-action-recovery.mjs';
const base={firstInvalid:true,action:{type:'move_arrow',observation:'看到道路',round:4},mode:'move',map:{x:800,y:500,width:200,height:200},width:1000,height:800,topOffset:70,lookup:async()=> 'map'};
test('连续无效箭头后只转到可见地图，不点击街景',async()=>{const a=await recoverInvalidArrows(base);assert.equal(a.type,'hover');assert.equal(a.x,.9);assert.equal(a.y,.6625);assert.equal(a.observation,'看到道路')});
test('目标不是地图、首次无效、其他模式均不自动恢复',async()=>{assert.equal(await recoverInvalidArrows({...base,lookup:async()=> 'panorama'}),null);assert.equal(await recoverInvalidArrows({...base,firstInvalid:false}),null);assert.equal(await recoverInvalidArrows({...base,mode:'fixed'}),null)});
test('无效悬停可恢复到经命中检查的地图中心，不修改观察',async()=>{const a=await recoverInvalidMapHover({...base,action:{type:'hover',x:.2,y:.3,observation:'看到山地',reason:'展开',round:1}});assert.equal(a.type,'hover');assert.equal(a.x,.9);assert.equal(a.y,.6625);assert.equal(a.observation,'看到山地')});
test('无法确认地图命中、不可见或不是悬停时不恢复',async()=>{const a={...base,action:{type:'hover'}};assert.equal(await recoverInvalidMapHover({...a,lookup:async()=> 'panorama'}),null);assert.equal(await recoverInvalidMapHover({...a,map:null}),null);assert.equal(await recoverInvalidMapHover({...a,action:{type:'click'}}),null);assert.equal(await recoverInvalidMapHover({...a,map:{x:10000,y:1,width:10,height:10}}),null)});
