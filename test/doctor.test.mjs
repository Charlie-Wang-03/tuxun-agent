import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runDiagnostics} from '../src/doctor.mjs';

test('只检查本地版本与路径，不把 CLI 可用当成已登录',()=>{
  let call;
  const rows=runDiagnostics({platform:'win32',nodeVersion:'v22.5.0',env:{CHROME_PATH:'fixture-chrome'},exists:p=>p==='fixture-chrome',spawn:(...args)=>{call=args;return {status:0,stdout:'codex-cli 1.0.0\n'}}});
  assert.deepEqual(call[0],'codex'); assert.deepEqual(call[1],['--version']);
  assert.equal(rows.find(r=>r.name==='Chrome').status,'ok');
  assert.equal(rows.find(r=>r.name==='Codex CLI').status,'ok');
  assert.equal(rows.find(r=>r.name==='Codex 登录状态').status,'unknown');
});

test('缺失依赖与不支持的平台分别报告',()=>{
  const rows=runDiagnostics({platform:'linux',nodeVersion:'v20.0.0',env:{},exists:()=>false,spawn:()=>({status:null,error:Error('missing')})});
  assert.equal(rows.find(r=>r.name==='操作系统').status,'unsupported');
  assert.equal(rows.find(r=>r.name==='Node.js').status,'unsupported');
  assert.equal(rows.find(r=>r.name==='Chrome').status,'missing');
  assert.equal(rows.find(r=>r.name==='Codex CLI').status,'missing');
});
