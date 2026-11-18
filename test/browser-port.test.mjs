import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {listenBrowserSafe} from '../src/browser-port.mjs';

test('浏览器端口冲突时在本机回环地址重试', async () => {
  const server = new EventEmitter();
  const calls = [];
  server.listen = (port, host) => {
    calls.push({port, host});
    queueMicrotask(() => calls.length === 1 ? server.emit('error', Object.assign(Error('occupied'), {code:'EADDRINUSE'})) : server.emit('listening'));
  };
  server.address = () => ({port:23457});
  const ports = [23456, 23457];
  assert.equal(await listenBrowserSafe(server, {pickPort: () => ports.shift()}), 23457);
  assert.deepEqual(calls, [{port:23456, host:'127.0.0.1'}, {port:23457, host:'127.0.0.1'}]);
  assert.equal(server.listenerCount('error'), 0);
});

test('非端口可用性错误立即报告', async () => {
  const server = new EventEmitter();
  let calls = 0;
  server.listen = () => { calls++; queueMicrotask(() => server.emit('error', Object.assign(Error('invalid'), {code:'EINVAL'}))); };
  await assert.rejects(listenBrowserSafe(server), {code:'EINVAL'});
  assert.equal(calls, 1);
});

test('Windows 保留端口拒绝绑定时改选端口，持续拒绝仍有界失败', async () => {
  const server = new EventEmitter();
  const calls = [];
  server.listen = (port, host) => {
    calls.push({port,host});
    queueMicrotask(() => calls.length === 1 ? server.emit('error',Object.assign(Error('reserved'),{code:'EACCES'})) : server.emit('listening'));
  };
  server.address = () => ({port:23458});
  const ports = [49816,23458];
  assert.equal(await listenBrowserSafe(server,{pickPort:()=>ports.shift(),platform:'win32'}),23458);
  assert.deepEqual(calls,[{port:49816,host:'127.0.0.1'},{port:23458,host:'127.0.0.1'}]);
  assert.equal(server.listenerCount('error'),0);
  let denied = 0;
  server.listen = () => {denied++;queueMicrotask(()=>server.emit('error',Object.assign(Error('denied'),{code:'EACCES'})));};
  await assert.rejects(listenBrowserSafe(server,{platform:'win32',attempts:3}),{code:'EACCES'});
  assert.equal(denied,3);assert.equal(server.listenerCount('error'),0);assert.equal(server.listenerCount('listening'),0);
  denied=0;
  await assert.rejects(listenBrowserSafe(server,{platform:'linux',attempts:3}),{code:'EACCES'});
  assert.equal(denied,1);
});
