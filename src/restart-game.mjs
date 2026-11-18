// The caller must recheck the permitted page and stop/budget guard before input.
// A failed or uncertain transition is never clicked twice.
export async function restartGame({findButton, click, read, guard, wait, attempts=30}) {
  await guard();
  const button=await findButton();
  if(!button)throw Error('无法确认唯一可见的再来一局按钮');
  await guard();
  await click(button);
  for(let i=0;i<attempts;i++){
    await wait();
    await guard();
    const state=await read();
    if(state && state.round===1 && state.score===0 && !state.result)return state;
  }
  throw Error('未确认新一局，已停止且未重复点击');
}
