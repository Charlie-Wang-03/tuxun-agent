import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markerAtClick, selectionVerdict, correctionHint, invalidatesCorrection } from '../src/selection.mjs';

test('标记需要位于点击附近，异常坐标不能通过',()=>{assert.equal(markerAtClick({x:110,y:105},{x:100,y:100}),true);assert.equal(markerAtClick({x:180,y:100},{x:100,y:100}),false);assert.equal(markerAtClick(null,{x:1,y:1}),false)});
test('只接受明确核对状态，未知结果不能当成匹配',()=>{assert.equal(selectionVerdict({verdict:'match',marker:'近海',reason:'匹配',target_country_code:'',evidence_label:'日本',approximate_ok:false,has_correction:false,correction_x:0,correction_y:0}).verdict,'match');assert.throws(()=>selectionVerdict({verdict:'unknown',marker:'',reason:''}))});
test('仅接受范围内的不匹配修正建议',()=>{const a={verdict:'mismatch',marker:'海上',reason:'偏离目标',target_country_code:'',evidence_label:'',approximate_ok:false,has_correction:true,correction_x:.5,correction_y:.7};assert.equal(selectionVerdict(a),a);assert.throws(()=>selectionVerdict({...a,correction_x:1.1}));assert.throws(()=>selectionVerdict({...a,verdict:'match'}))});
test('修正建议仅在存在地图局部图时提供，不误称图像序号',()=>{assert.equal(correctionHint({has_correction:false}),'');const audit={has_correction:true,correction_x:.5,correction_y:.7};const text=correctionHint(audit);assert.match(text,/当前地图局部图/);assert.match(text,/x=0.5, y=0.7/);assert.doesNotMatch(text,/第三张/);assert.equal(correctionHint(audit,false),'')});
test('地图缩放和改变选点使旧坐标失效，街景转向不使其失效',()=>{assert.equal(invalidatesCorrection('map_scroll','map'),true);assert.equal(invalidatesCorrection('hover','map'),true);assert.equal(invalidatesCorrection('click','map'),true);assert.equal(invalidatesCorrection('drag','panorama'),false);assert.equal(invalidatesCorrection('scroll','panorama'),false)});
test('缺少标记描述时不能通过核对',()=>{assert.throws(()=>selectionVerdict({verdict:'match',marker:'',reason:'看似一致',target_country_code:'',evidence_label:'日本',approximate_ok:false,has_correction:false,correction_x:0,correction_y:0}))});

test('图钉靠近地图边缘时不能进入最终核对', async () => {
  const {markerHasContext}=await import('../src/selection.mjs');
  assert.equal(markerHasContext({x:0,y:0,width:1000,height:500,pin:{x:972,y:250}}),false);
  assert.equal(markerHasContext({x:0,y:0,width:1000,height:500,pin:{x:500,y:250}}),true);
  assert.equal(markerHasContext({x:0,y:0,width:0,height:500,pin:{x:0,y:250}}),false);
});

test('匹配结论必须有具体可见地名证据',()=>{const a={verdict:'match',marker:'北美',reason:'匹配',target_country_code:'',evidence_label:'北美洲',approximate_ok:false,has_correction:false,correction_x:0,correction_y:0};assert.equal(selectionVerdict(a).verdict,'uncertain');assert.equal(selectionVerdict({...a,target_country_code:'',evidence_label:''}).verdict,'uncertain');assert.equal(selectionVerdict({...a,target_country_code:'',evidence_label:'纽约'}).verdict,'match')});

test('缺乏地名证据的伪匹配不得自动转为可接受的范围结果',()=>{
 const a={verdict:'match',marker:'地图上',reason:'可能一致',target_country_code:'',evidence_label:'',approximate_ok:true,has_correction:false,correction_x:0,correction_y:0};
 const out=selectionVerdict(a);assert.equal(out.verdict,'uncertain');assert.equal(out.approximate_ok,false);
});

test('国家代码必须为两位大写或明确留空，不能以畸形字段绕过国家核对',()=>{
 const a={verdict:'match',marker:'图钉',reason:'匹配',evidence_label:'日本',target_country_code:'JP',approximate_ok:false,has_correction:false,correction_x:0,correction_y:0};
 assert.equal(selectionVerdict(a).target_country_code,'JP');
 assert.equal(selectionVerdict({...a,target_country_code:''}).verdict,'match');
 for(const code of [undefined,null,'jp','JP ','JPN'])assert.throws(()=>selectionVerdict({...a,target_country_code:code}),/国家代码无效/);
});
