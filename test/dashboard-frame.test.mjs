import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureFrame} from '../src/dashboard-frame.mjs';

const target = {type:'page',url:'https://tuxun.fun/challenge/00000000-0000-4000-8000-000000000000',title:'题库经典五题 - 图寻 - 探索世界',webSocketDebuggerUrl:'ws://127.0.0.1/mock'};
const response = pages => async () => ({ok:true,json:async()=>pages});

test('预览仅捕获唯一目标页面，并在结束后关闭连接', async () => {
  let closed = false, method;
  const connect = async () => ({call:async m=>{method=m;return {data:Buffer.from('mock image').toString('base64')}},close:()=>{closed=true}});
  const data = await captureFrame({fetchTargets:response([target]),connect});
  assert.equal(data.toString(), 'mock image');
  assert.equal(method, 'Page.captureScreenshot');
  assert.equal(closed, true);
  await assert.rejects(captureFrame({fetchTargets:response([target,target]),connect}),/等待专用/);
  await assert.rejects(captureFrame({fetchTargets:response([{...target,title:'每日挑战'}]),connect}),/等待专用/);
});

test('截图失败时也关闭预览连接', async () => {
  let closed = false;
  const connect = async () => ({call:async()=>{throw Error('截图失败')},close:()=>{closed=true}});
  await assert.rejects(captureFrame({fetchTargets:response([target]),connect}),/截图失败/);
  assert.equal(closed, true);
});
