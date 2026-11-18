import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStopControl,bindStopSignals} from '../src/stop-control.mjs';
import {EventEmitter} from 'node:events';

test('停止后拒绝新的浏览器输入且只触发一次停止回调', () => {
  let calls = 0;
  const control = createStopControl(() => calls++);
  assert.doesNotThrow(() => control.guard('Input.dispatchMouseEvent'));
  control.stop();
  control.stop();
  assert.equal(calls, 1);
  assert.equal(control.stopped, true);
  assert.throws(() => control.guard('Input.dispatchMouseEvent'), /停止/);
  assert.doesNotThrow(() => control.guard('Runtime.evaluate'));
});
test('SIGINT、SIGTERM 与显式停止共用一次回调，退出移除监听',()=>{
  for(const signal of ['SIGINT','SIGTERM']){
    const emitter=new EventEmitter();let calls=0;
    const control=createStopControl(()=>calls++),unbind=bindStopSignals(control,emitter);
    emitter.emit(signal);emitter.emit(signal);control.stop();
    assert.equal(calls,1);assert.equal(control.source,signal);assert.throws(()=>control.check(),/停止/);
    unbind();assert.equal(emitter.listenerCount(signal),0);
  }
});
