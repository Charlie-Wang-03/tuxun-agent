import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clickAndWait } from '../src/transitions.mjs';

test('状态延迟时只点击一次，直到确认页面已改变', async () => {
  let clicks = 0, reads = 0;
  const result = await clickAndWait(() => { clicks++; }, () => ({ round: ++reads < 3 ? 1 : 2 }), s => s.round === 2, { attempts: 4, sleep: async () => {} });
  assert.equal(clicks, 1); assert.equal(reads, 3); assert.equal(result.round, 2);
});

test('页面没有切换时停止，不重复点击', async () => {
  let clicks = 0;
  await assert.rejects(clickAndWait(() => { clicks++; }, () => ({ round: 1 }), s => s.round === 2, { attempts: 3, sleep: async () => {} }), /未重复点击/);
  assert.equal(clicks, 1);
});
