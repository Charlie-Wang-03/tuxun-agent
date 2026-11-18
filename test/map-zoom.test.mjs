import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planMapZoom,dispatchMapWheel} from '../src/map-zoom.mjs';

test('边缘放大转换为对侧缩小，保留重新观察机会',()=>{
 const original={type:'map_scroll',x:.956,y:.515,delta:-360,reason:'放大韩国'};
 const result=planMapZoom(original);
 assert.equal(result.reframed,true);assert.equal(result.action.delta,360);assert.equal(result.action.x,.18);
 const targetAfter=result.action.x+.75*(original.x-result.action.x);
 assert.ok(targetAfter<original.x && targetAfter>.5);
 assert.deepEqual(original,{type:'map_scroll',x:.956,y:.515,delta:-360,reason:'放大韩国'});
});
test('中心放大及主动缩小保留原样',()=>{
 const center={type:'map_scroll',x:.5,y:.5,delta:-360};const out={type:'map_scroll',x:.96,y:.5,delta:360};
 assert.equal(planMapZoom(center).action,center);assert.equal(planMapZoom(out).action,out);
});
test('滚轮前先移动鼠标并重新核对地图目标',async()=>{
 const calls=[];await dispatchMapWheel({x:20,y:30,move:async()=>calls.push('move'),wait:async()=>calls.push('wait'),target:async()=>{calls.push('target');return true},wheel:async()=>calls.push('wheel')});
 assert.deepEqual(calls,['move','wait','target','wheel']);
});
test('地图布局变化时不发送滚轮',async()=>{
 let called=false;await assert.rejects(dispatchMapWheel({x:20,y:30,move:async()=>{},wait:async()=>{},target:async()=>false,wheel:async()=>{called=true}}),/未缩放/);assert.equal(called,false);
});
