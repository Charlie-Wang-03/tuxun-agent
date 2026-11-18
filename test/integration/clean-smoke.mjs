// Verify offline tests against an isolated source copy without .git or artifacts.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cp,mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../',import.meta.url));
const tempRoot = await realpath(tmpdir());
const workspace = await mkdtemp(path.join(tempRoot,'tuxun-clean-'));
try {
  for(const entry of ['src','test','package.json'])await cp(path.join(root,entry),path.join(workspace,entry),{recursive:true});
  const manifest=JSON.parse(await readFile(path.join(workspace,'package.json'),'utf8'));
  assert.equal(manifest.scripts.test,'node --test test/*.test.mjs');
  const run=spawnSync(process.execPath,['--test','test/*.test.mjs'],{cwd:workspace,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:10*1024*1024});
  if(run.error)throw run.error;
  if(run.status!==0)throw Error(`隔离测试失败 (${run.status})：\n${run.stdout}\n${run.stderr}`);
  const summary=run.stdout.split(/\r?\n/).filter(line=>/^(?:ℹ|#) (?:tests|pass|fail|skipped)\b/.test(line)).join('；');
  assert.match(run.stdout,/(?:ℹ|#) fail 0/);
  assert.match(run.stdout,/(?:ℹ|#) skipped 0/,'隔离测试不能跳过本机接口检查');
  const help=spawnSync(process.execPath,['src/cli.mjs','run','--help'],{cwd:workspace,encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(help.status,0);
  assert.match(help.stdout,/用法/);
  console.log(`无 .git、artifacts 或 node_modules 的隔离目录通过离线测试与 CLI 帮助：${summary}`);
} finally {
  // Remove only the directory created by this test under the resolved OS temp root.
  const resolved=await realpath(workspace).catch(()=>null);
  if(resolved && path.dirname(resolved)===tempRoot && path.basename(resolved).startsWith('tuxun-clean-'))await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
