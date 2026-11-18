import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';

test('控制台仅允许本机同源请求，拒绝无效启动参数', async t => {
  const child = spawn(process.execPath, ['src/dashboard.mjs'], {stdio:['ignore','pipe','pipe'], windowsHide:true});
  t.after(() => child.kill());
  let output = '';
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('控制台启动超时')), 5000);
    child.on('error', reject);
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
  });
  let response;
  try { response = await fetch(base); }
  catch (error) { if (error.cause?.code === 'EACCES') { t.skip('当前沙箱阻止本机回环连接'); return; } throw error; }
  const html = await response.text();
  const token = html.match(/const token='([0-9a-f]+)'/)?.[1];
  assert.ok(token);
  for(const asset of ['dashboard.css','dashboard-client.mjs','dashboard-model.mjs','dashboard-summary.mjs','review-data.mjs']){const resource=await fetch(base+'/'+asset);assert.equal(resource.status,200);assert.match(resource.headers.get('content-type'),/text\/(?:css|javascript)/);}
  assert.equal((await fetch(base+'/cli.mjs',{headers:{'x-dashboard-token':token}})).status,404);
  assert.equal((await fetch(base+'/artifacts/runs/events.jsonl',{headers:{'x-dashboard-token':token}})).status,404);
  const wrongHostStatus = await new Promise((resolve,reject)=>{
    const request=http.get(base,{headers:{host:'localhost:'+new URL(base).port}},response=>{response.resume();resolve(response.statusCode)});
    request.on('error',reject);
  });
  assert.equal(wrongHostStatus, 403);
  const malformedStatus=await new Promise((resolve,reject)=>{
    const request=http.get(base,{path:'http://[',headers:{host:new URL(base).host}},response=>{response.resume();resolve(response.statusCode)});
    request.on('error',reject);
  });
  assert.equal(malformedStatus,400,'无效 URL 不能导致控制台进程退出');
  assert.equal((await fetch(`${base}/api/status`)).status, 403);
  assert.equal((await fetch(`${base}/api/status`, {headers:{'x-dashboard-token':token}})).status, 200);
  const payload = JSON.stringify({confirm:true, mode:'invalid', roundSeconds:300, totalSeconds:1800, maxActions:35});
  const headers = {'x-dashboard-token':token, 'content-type':'application/json'};
  assert.equal((await fetch(`${base}/api/start`, {method:'POST',headers:{...headers,origin:base},body:JSON.stringify({confirm:false})})).status, 400);
  assert.equal((await fetch(`${base}/api/start`, {method:'POST',headers:{...headers,origin:'http://evil.example'},body:payload})).status, 403);
  assert.equal((await fetch(`${base}/api/start`, {method:'POST',headers:{...headers,origin:base},body:payload})).status, 400);
  assert.equal((await (await fetch(`${base}/api/status`, {headers:{'x-dashboard-token':token}})).json()).running, false);
});
