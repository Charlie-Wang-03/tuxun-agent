// A submission or navigation is dispatched once; uncertain state never triggers a retry.
export async function clickAndWait(click, read, predicate, options = {}) {
  const attempts = options.attempts ?? 30;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const delay = options.delay ?? 500;
  await click();
  for (let i = 0; i < attempts; i++) {
    await sleep(delay);
    const state = await read();
    if (predicate(state)) return state;
  }
  throw Error('页面状态未按预期改变，已停止，未重复点击');
}
