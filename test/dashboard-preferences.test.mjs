import test from 'node:test';
import assert from 'node:assert/strict';
import {minutesToSeconds, readPreferences, savePreferences, resolvedTheme, preferenceKey} from '../src/dashboard-preferences.mjs';
import {english, translate} from '../src/dashboard-i18n.mjs';
import {eventDetail, eventTitle, durationText, tokenText} from '../src/dashboard-model.mjs';

test('分钟输入按整分钟转换，拒绝小数、零和不安全数值', () => {
  assert.equal(minutesToSeconds('5'),300);
  assert.equal(minutesToSeconds('30'),1800);
  assert.equal(minutesToSeconds('6'),360);
  for(const value of ['',0,-1,0.5,1.5,Infinity,'abc',Number.MAX_SAFE_INTEGER])assert.ok(Number.isNaN(minutesToSeconds(value)));
});

test('语言和主题偏好规范化，存储失效不阻止页面使用', () => {
  let saved;
  const storage={getItem:()=>saved,setItem:(key,value)=>{assert.equal(key,preferenceKey);saved=value;}};
  assert.deepEqual(readPreferences(storage),{language:'zh',theme:'system'});
  savePreferences(storage,{language:'en',theme:'dark'});
  assert.deepEqual(readPreferences(storage),{language:'en',theme:'dark'});
  saved='{"language":"xx","theme":"invalid"}';
  assert.deepEqual(readPreferences(storage),{language:'zh',theme:'system'});
  saved='bad json';assert.equal(readPreferences(storage).theme,'system');
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  assert.equal(readPreferences(blocked).language,'zh');
  assert.doesNotThrow(()=>savePreferences(blocked,{language:'en',theme:'dark'}));
  assert.equal(resolvedTheme('system',true),'dark');
  assert.equal(resolvedTheme('system',false),'light');
  assert.equal(resolvedTheme('light',true),'light');
  assert.equal(resolvedTheme('dark',false),'dark');
});

test('翻译只插入一次参数，不改写模型原文和未知事件', () => {
  const t=(value,...values)=>translate('en',value,...values);
  const raw='原始路牌 {1} <img src=x> 暂无记录';
  assert.equal(t`兜底原因：${raw}`,`Fallback reason: ${raw}`);
  assert.equal(eventDetail({kind:'decision',action:{observation:raw,type:'map_select',reason:'未知'}},t),`${raw} · Map selection · 未知`);
  assert.equal(eventTitle({kind:'result'},t),'Round result');
  assert.equal(eventTitle({kind:'future_event'},t),'future_event');
  assert.equal(durationText(300,t),'5 min');
  assert.equal(tokenText({legacy:true,structured:true},t),'Mixed accounting; not summed');
  assert.equal(eventDetail({kind:'action_executed',type:'map_select'}),'地图选点已执行');
});

test('全部英文模板保留原消息的参数编号', () => {
  const slots=s=>[...s.matchAll(/\{(\d+)\}/g)].map(m=>m[1]).sort();
  for(const [key,value] of Object.entries(english))assert.deepEqual(slots(value),slots(key),key);
});
