import { test } from 'node:test';import assert from 'node:assert/strict';import {useMapOnly} from '../src/map-stage.mjs';
import {captureDecisionImages} from '../src/map-stage.mjs';
test('只有展开地图并进入地图动作后采用地图局部图',()=>{
 const map={width:800,height:600};
 assert.equal(useMapOnly([{type:'hover'}],map,'map.png'),true);
 assert.equal(useMapOnly([{type:'map_scroll'}],map,'map.png'),true);
 assert.equal(useMapOnly([{type:'return_to_street'}],map,'map.png'),false);
 assert.equal(useMapOnly([{type:'hover'}],{width:200,height:150},'map.png'),false);
 assert.equal(useMapOnly([{type:'hover'}],map,null),false);
});

test('地图阶段沿用展开地图前的最新街景观察',async()=>{const {latestStreetObservation}=await import('../src/map-stage.mjs');const history=[{type:'drag',observation:'旧视角'},{type:'hover',observation:'新视角见路牌'},{type:'map_scroll',observation:'地图判断'}];assert.equal(latestStreetObservation(history),'新视角见路牌')});

test('地图决策仅使用本步地图证据，返回街景、地图不可用或自动核对时保留完整捕获',async()=>{
  const calls=[],base={history:[{type:'map_scroll'}],mapRect:{width:800,height:600},mapImage:'map-current.png',captureStreet:async()=>{calls.push('street');return 'street-current.png'},captureCompass:async()=>{calls.push('compass');return 'compass-current.png'}};
  assert.deepEqual(await captureDecisionImages(base),{image:'map-current.png',compass:null,mapOnly:true});assert.deepEqual(calls,[]);
  for(const change of [{history:[{type:'return_to_street'}]},{mapImage:null},{mapRect:{width:200,height:100}},{requireStreetEvidence:true}]){
    calls.length=0;const result=await captureDecisionImages({...base,...change});
    assert.equal(result.image,'street-current.png');assert.equal(result.compass,'compass-current.png');assert.deepEqual(calls,['street','compass']);
  }
});
test('需要街景时捕获失败原样抛出，不复用旧图或补发其他截图',async()=>{
  const failure=Error('capture unavailable');let compass=0;
  await assert.rejects(captureDecisionImages({history:[],mapImage:null,captureStreet:async()=>{throw failure},captureCompass:async()=>compass++}),e=>e===failure);
  assert.equal(compass,0);
});
