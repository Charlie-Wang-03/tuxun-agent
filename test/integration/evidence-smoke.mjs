import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('./stop-smoke.mjs',import.meta.url));
for(const scenario of ['decode-street','decode-map','write-street','write-compass','write-map','read-map','write-audit','read-audit','write-forced','write-result','write-events','read-model','bad-state']){
  const result=spawnSync(process.execPath,[script,`--evidence-failure=${scenario}`],{stdio:'inherit',windowsHide:true,timeout:30000});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(`证据模拟失败：${scenario}（${result.signal??result.status}）`);
}
