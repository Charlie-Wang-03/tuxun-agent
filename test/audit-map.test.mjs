import {test}from'node:test';import assert from'node:assert/strict';import{prepareAuditMap}from'../src/audit-map.mjs';
const valid={x:0,y:0,width:800,height:600,pin:{x:400,y:300}};
test('核对前只放大一次并使用新截图和图钉位置',async()=>{let count=0;const next={...valid,pin:{x:401,y:300}};const result=await prepareAuditMap({evidence:valid,zoom:async()=>count++,verify:async()=>{},capture:async()=>next});assert.equal(count,1);assert.equal(result,next)});
test('边缘图钉不触发缩放',async()=>{let count=0;await assert.rejects(prepareAuditMap({evidence:{...valid,pin:{x:799,y:300}},zoom:async()=>count++,verify:async()=>{},capture:async()=>valid}),/边缘/);assert.equal(count,0)});
test('缩放后失去图钉时停止，不重复缩放',async()=>{let count=0;await assert.rejects(prepareAuditMap({evidence:valid,zoom:async()=>count++,verify:async()=>{},capture:async()=>({...valid,pin:null})}),/上下文不足/);assert.equal(count,1)});
