// Explicit local-only suite: each scenario creates its own CLI copy and server.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('./stop-smoke.mjs',import.meta.url));
for(const args of [
  ['--lock-contention'],
  ['--signal-read'],['--signal-input'],['--signal-model'],['--signal-read','--sigterm'],
  ['--budget-before-input'],['--budget-before-release'],['--budget-fallback'],['--input-failure']
]){
  console.log(`模拟场景：${args.join(' ')}`);
  const result=spawnSync(process.execPath,[script,...args],{stdio:'inherit',windowsHide:true,timeout:30000});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(`模拟失败：${args.join(' ')}（${result.signal ?? result.status}）`);
}
