import {test} from 'node:test';import assert from 'node:assert/strict';import {parseRunOptions} from '../src/run-options.mjs';
test('默认和指定模式及预算',()=>{const d=parseRunOptions([]);assert.equal(d.mode,'fixed');assert.equal(d.limits.roundSeconds,300);const r=parseRunOptions(['--mode','fixed-view','--round-seconds','100','--verify-current']);assert.equal(r.mode,'fixed-view');assert.equal(r.limits.roundSeconds,100);assert.equal(r.verifyCurrent,true)});
test('无效参数在连接浏览器前明确报错',()=>{assert.throws(()=>parseRunOptions(['--mode','other']),/模式必须/);assert.throws(()=>parseRunOptions(['--max-actions']),/正整数/);assert.throws(()=>parseRunOptions(['--wrong','1']),/未知参数/);assert.equal(parseRunOptions(['--help']).help,true)});
test('对象原型属性名不能被当作运行参数',()=>{
  for(const name of ['constructor','toString','__proto__'])assert.throws(()=>parseRunOptions([name,'1']),/未知参数/);
});
test('局数默认为一局，可设置正整数且不能与验证已有选点混用',()=>{assert.equal(parseRunOptions([]).limits.games,1);assert.equal(parseRunOptions(['--games','3']).limits.games,3);assert.throws(()=>parseRunOptions(['--games','0']),/正整数/);assert.throws(()=>parseRunOptions(['--games','2','--verify-current']),/不能与多局/)});
test('CLI 首题剩余预算不能超过对应单题预算',()=>{
  assert.throws(()=>parseRunOptions(['--round-seconds','20','--initial-round-seconds','21']),/首题剩余时间/);
  assert.throws(()=>parseRunOptions(['--max-actions','5','--initial-max-actions','6']),/首题剩余操作/);
  assert.equal(parseRunOptions(['--initial-round-seconds','20','--round-seconds','20']).limits.initialRoundSeconds,20);
});

test('模型和强度可独立覆盖，缺失或非法配置在启动前拒绝', () => {
  const config = (...args) => parseRunOptions(args).modelConfig;
  assert.deepEqual(config(), {model:'gpt-6-astra', reasoning_effort:'high'});
  assert.deepEqual(config('--model','gpt-5.6-sol'), {model:'gpt-5.6-sol', reasoning_effort:'high'});
  assert.deepEqual(config('--reasoning-effort','low'), {model:'gpt-6-astra', reasoning_effort:'low'});
  for (const value of [undefined, '', '--help', 'a b', 'a\nb']) assert.throws(()=>config('--model',value), /--model/);
  for (const value of [undefined, '', '--model', 'extra']) assert.throws(()=>config('--reasoning-effort',value), /--reasoning-effort/);
});
