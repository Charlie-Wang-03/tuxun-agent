import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CDP} from '../src/cdp.mjs';

test('调试连接一直不建立时超时并关闭连接', async () => {
  const Original = globalThis.WebSocket;
  let closed = false;
  globalThis.WebSocket = class {
    addEventListener() {}
    close() { closed = true; }
  };
  try {
    await assert.rejects(CDP.connect('ws://example.invalid', 10), /连接浏览器调试端口超时/);
    assert.equal(closed, true);
  } finally { globalThis.WebSocket = Original; }
});
test('主动关闭连接立即拒绝在途调用，不等待远端 close 或超时',async()=>{
  let closed=0;
  const cdp=new CDP({addEventListener(){},send(){},close(){closed++;}});
  const pending=cdp.call('Runtime.evaluate',{},30000);
  cdp.close();
  await assert.rejects(pending,/连接已关闭/);
  assert.equal(cdp.pending.size,0);assert.equal(closed,1);
});

test('无效调试消息拒绝等待并关闭连接，不抛出事件回调异常或继续发送',async()=>{
  for(const data of ['{invalid','null','[]']) {
    const listeners=new Map();let sent=0,closed=0;
    const cdp=new CDP({addEventListener(name,fn){listeners.set(name,fn);},send(){sent++;},close(){closed++;}});
    const pending=cdp.call('Runtime.evaluate');
    assert.doesNotThrow(()=>listeners.get('message')({data}));
    await assert.rejects(pending,/调试消息无效/);
    await assert.rejects(cdp.call('Input.dispatchMouseEvent'),/连接已关闭/);
    cdp.close();assert.equal(sent,1);assert.equal(closed,1);assert.equal(cdp.pending.size,0);
  }
});

test('连接错误立即拒绝全部等待，正常协议事件不影响响应配对',async()=>{
  const listeners=new Map();
  const cdp=new CDP({addEventListener(name,fn){listeners.set(name,fn);},send(){},close(){}});
  const first=cdp.call('Page.enable');
  listeners.get('message')({data:JSON.stringify({method:'Page.loadEventFired'})});
  listeners.get('message')({data:JSON.stringify({id:1,result:{ok:true}})});
  assert.deepEqual(await first,{ok:true});
  const second=cdp.call('Runtime.evaluate');listeners.get('error')();
  await assert.rejects(second,/调试连接错误/);
  assert.equal(cdp.pending.size,0);
});
