import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {resolveCodexRuntime} from '../src/model-process.mjs';
import {runDiagnostics} from '../src/doctor.mjs';

test('只检查本地版本与路径，不把 CLI 可用当成已登录',()=>{
  let call;
  const rows=runDiagnostics({platform:'win32',nodeVersion:'v22.5.0',env:{CHROME_PATH:'fixture-chrome'},exists:p=>p==='fixture-chrome',spawn:(...args)=>{call=args;return {status:0,stdout:'codex-cli 0.170.0\n'}}});
  assert.ok(path.isAbsolute(call[0])); assert.match(call[0],/node_modules.*codex-win32-.*codex\.exe$/); assert.deepEqual(call[1],['--version']);
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

test('本地 Codex 缺失或版本错误时拒绝运行',()=>{
  for (const result of [{status:null,stdout:null},{status:0,stdout:'codex-cli 0.150.1'}]) {
    let calls=0;
    assert.throws(()=>resolveCodexRuntime({platform:'win32',arch:'x64',spawn(executable){
      calls++; assert.ok(path.isAbsolute(executable)); return result;
    }}),/0\.170\.0/);
    assert.equal(calls,1);
  }
});
