import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {spawn} from 'node:child_process';
import {PassThrough} from 'node:stream';
import {readModelProcess} from '../src/model-process.mjs';

function fakeChild() {
  const child=new EventEmitter(); child.stdout=new PassThrough(); child.stderr=new PassThrough(); child.kills=0;
  child.kill=()=>{child.kills++;return true}; return child;
}

test('停止时不等待子进程 close，立即结束模型等待', async()=>{
  const child=fakeChild(), controller=new AbortController();
  const result=readModelProcess(child,{timeoutMs:10000,signal:controller.signal});
  controller.abort();
  await assert.rejects(result,/用户已请求停止/);
  assert.equal(child.kills,1);
  assert.equal(child.stdout.destroyed,true);
  assert.equal(child.stderr.destroyed,true);
  child.emit('close',1);
});

test('模型超时结束等待，即使子进程没有报告 close', async()=>{
  const child=fakeChild();
  await assert.rejects(readModelProcess(child,{timeoutMs:10}),/模型调用超时/);
  assert.equal(child.kills,1);
});

test('停止时保留已完整返回的用量，并忽略末尾截断行', async()=>{
  const child=fakeChild(),controller=new AbortController();
  const result=readModelProcess(child,{timeoutMs:10000,signal:controller.signal});
  child.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,cached_input_tokens:2,output_tokens:3}})+'\n{"partial":');
  controller.abort();
  await assert.rejects(result,error=>error.message.includes('停止')&&error.tokens===13&&error.usage.cached_input_tokens===2);
});

test('停止时没有完整用量事件则保持未知', async()=>{
  const child=fakeChild(),controller=new AbortController();
  const result=readModelProcess(child,{timeoutMs:10000,signal:controller.signal});
  child.stdout.write('{"type":"turn.completed","usage":');
  controller.abort();
  await assert.rejects(result,error=>error.message.includes('停止')&&error.tokens===undefined&&error.usage===undefined);
});

test('停止会终止实际的本地模拟子进程', async t=>{
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  t.after(()=>{if(child.exitCode===null && child.signalCode===null)child.kill()});
  const controller=new AbortController();
  const result=readModelProcess(child,{timeoutMs:10000,signal:controller.signal});
  const closed=once(child,'close',{signal:AbortSignal.timeout(5000)});
  await once(child,'spawn');
  controller.abort();
  await assert.rejects(result,/用户已请求停止/);
  await closed;
});

test('正常完成和无效 JSON 都保留模型返回的用量', async()=>{
  const run=async text=>{
    const child=fakeChild(),result=readModelProcess(child,{timeoutMs:1000});
    child.stdout.write([{type:'item.completed',item:{type:'agent_message',text}},{type:'turn.completed',usage:{input_tokens:10,cached_input_tokens:2,output_tokens:3}}].map(JSON.stringify).join('\n'));
    child.emit('close',0);
    return result;
  };
  const success=await run('{"type":"hover"}');
  assert.equal(success.tokens,13);
  await assert.rejects(run('{bad'),error=>error.tokens===13 && error.usage.cached_input_tokens===2);
});

test('跨数据块的 UTF-8 模型文字保持完整', async()=>{
  const child=fakeChild(),result=readModelProcess(child,{timeoutMs:1000});
  const output=[{type:'item.completed',item:{type:'agent_message',text:'{"observation":"道路"}'}},{type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}].map(JSON.stringify).join('\n');
  const bytes=Buffer.from(output),split=bytes.indexOf(Buffer.from('道'))+1;
  child.stdout.write(bytes.subarray(0,split));child.stdout.write(bytes.subarray(split));child.emit('close',0);
  assert.equal((await result).value.observation,'道路');
});

test('异常退出、缺失消息及截断尾行仍保留已完成用量',async()=>{
  const completed=JSON.stringify({type:'turn.completed',usage:{input_tokens:10,cached_input_tokens:2,output_tokens:3}})+'\n';
  for(const [output,code] of [[completed,1],[completed,0],[completed+'{"partial":',0]]){
    const child=fakeChild(),result=readModelProcess(child,{timeoutMs:1000});
    child.stdout.write(output);child.emit('close',code);
    await assert.rejects(result,error=>error.tokens===13&&error.usage.cached_input_tokens===2);
  }
});
