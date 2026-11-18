import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {randomInt} from 'node:crypto';
import {acquireRunLock} from '../src/run-lock.mjs';

test('独立进程争用同一浏览器锁；正常退出和强制结束后均能重新取得',async t=>{
  const port=randomInt(20000,61000),children=[];
  t.after(()=>{for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill();});
  const start=async()=>{
    const child=fork(new URL('./fixtures/lock-worker.mjs',import.meta.url),[String(port)],{silent:true,windowsHide:true});children.push(child);
    const closed=once(child,'close');
    const [message]=await once(child,'message',{signal:AbortSignal.timeout(5000)});
    return {child,closed,message};
  };
  const first=await start();assert.equal(first.message.locked,true);
  const second=await start();assert.match(second.message.error,/已被另一运行占用/);assert.equal((await second.closed)[0],1);
  first.child.send('release');await first.closed;
  const third=await start();assert.equal(third.message.locked,true);
  third.child.kill('SIGKILL');await third.closed;
  const release=await acquireRunLock(port);await release();await release();
});
