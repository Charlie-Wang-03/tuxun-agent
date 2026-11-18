import { compareStreetFrames } from './image-check.mjs';
import { recoverInvalidMapHover } from './invalid-action-recovery.mjs';

export class MovementUnconfirmedError extends Error {}

// A stationary sampled frame is inconclusive. Only hover a verified map; never
// repeat the movement click or invent a new geographic observation.
export async function recoverUnconfirmedMovement({error, action, eligible, verify, map, width, height, topOffset, lookup, hover}) {
  if (!(error instanceof MovementUnconfirmedError) || !eligible()) return null;
  await verify();
  const recovered=await recoverInvalidMapHover({action:{...action,type:'hover'},map:await map(),width,height,topOffset,lookup});
  if (!recovered || !eligible()) return null;
  await verify();
  if (!eligible()) return null;
  await hover(recovered);
  return {...recovered,reason:'移动后画面变化未确认，不重复点击；依据已有街景观察继续地图定位。'};
}

// Click once, then allow time for delayed image loading without repeating the action.
export async function performMove({ mode, capture, click, wait, timeoutMs = 25000, intervalMs = 2000, now = Date.now, onProbe = async () => {} }) {
  if (mode !== 'move') throw Error('固定模式不允许移步换景');
  if (timeoutMs <= 0 || intervalMs <= 0) throw Error('时间上限');
  const before = await capture('before');
  if (before.black) throw Error('移动前街景接近全黑');
  await click();
  const deadline = now() + timeoutMs;
  let comparison = null, black = false;
  while (now() < deadline) {
    await wait(Math.min(intervalMs, Math.max(0, deadline - now())));
    const after = await capture('after');
    black = after.black;
    comparison = black ? null : compareStreetFrames(before, after);
    await onProbe({black, comparison});
    if (comparison?.changed) return comparison;
  }
  if (black) throw Error('移动后街景接近全黑，等待超时且不会重复点击');
  throw new MovementUnconfirmedError('移动后画面变化不足，等待超时且不会重复点击');
}
