// Verify branch/history separation with local-only temporary repositories.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const tempRoot = await realpath(tmpdir());
const root = await mkdtemp(path.join(tempRoot,'tuxun-remotes-'));
const local = path.join(root,'local'), release = path.join(root,'release');
const privateRemote = path.join(root,'private.git'), publicRemote = path.join(root,'public.git');
const globalConfig = path.join(root,'empty.gitconfig');
const templateDir = path.join(root,'empty-template');
await writeFile(globalConfig,'');
await mkdir(templateDir);
const env={...process.env};
for(const key of Object.keys(env))if(key.toUpperCase().startsWith('GIT_'))delete env[key];
Object.assign(env,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:globalConfig,GIT_TERMINAL_PROMPT:'0',GIT_TEMPLATE_DIR:templateDir});
function git(args,{expectFailure=false}={}) {
  const result=spawnSync('git',args,{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:20000});
  if(result.error)throw result.error;
  if(expectFailure){assert.notEqual(result.status,0,`git ${args[0]} 应失败`);return result.stdout.trim()}
  if(result.status!==0)throw Error(`git ${args[0]} 失败：${result.stderr}`);
  return result.stdout.trim();
}
try {
  git(['init','--bare',privateRemote]); git(['init','--bare',publicRemote]);
  git(['init','-b','main',local]);
  git(['-C',local,'config','user.name','Fixture User']); git(['-C',local,'config','user.email','fixture@example.invalid']);
  await writeFile(path.join(local,'public.txt'),'publishable fixture\n');
  await writeFile(path.join(local,'private.txt'),'PRIVATE_SENTINEL_DO_NOT_PUBLISH\n');
  git(['-C',local,'add','public.txt','private.txt']); git(['-C',local,'commit','-m','Private fixture']);
  const privateSha=git(['-C',local,'rev-parse','HEAD']);
  git(['-C',local,'remote','add','origin',privateRemote]);
  git(['-C',local,'remote','add','public',publicRemote]);
  git(['-C',local,'push','origin','main:refs/heads/main']);
  git(['-C',local,'worktree','add','--detach',release,'main']);
  git(['-C',release,'switch','--orphan','public-release']);
  await writeFile(path.join(release,'public.txt'),'publishable fixture\n');
  git(['-C',release,'add','public.txt']); git(['-C',release,'commit','-m','Public fixture']);
  const publicSha=git(['-C',release,'rev-parse','HEAD']);
  git(['-C',release,'push','public','public-release:refs/heads/main']);
  assert.notEqual(privateSha,publicSha);
  assert.equal(git(['--git-dir',privateRemote,'rev-parse','refs/heads/main']),privateSha);
  assert.equal(git(['--git-dir',publicRemote,'rev-parse','refs/heads/main']),publicSha);
  assert.equal(git(['--git-dir',publicRemote,'rev-list','--all','--count']),'1');
  git(['--git-dir',publicRemote,'cat-file','-e',`${privateSha}^{commit}`],{expectFailure:true});
  git(['--git-dir',publicRemote,'grep','-F','PRIVATE_SENTINEL_DO_NOT_PUBLISH','refs/heads/main'],{expectFailure:true});
  // A later public update is copied selectively; private history must remain unreachable.
  await writeFile(path.join(local,'public.txt'),'updated publishable fixture\n');
  await writeFile(path.join(local,'private.txt'),'PRIVATE_SENTINEL_DO_NOT_PUBLISH updated\n');
  git(['-C',local,'add','public.txt','private.txt']); git(['-C',local,'commit','-m','Private update']);
  const updatedPrivateSha=git(['-C',local,'rev-parse','HEAD']);
  await writeFile(path.join(release,'public.txt'),'updated publishable fixture\n');
  git(['-C',release,'add','public.txt']); git(['-C',release,'commit','-m','Public update']);
  const updatedPublicSha=git(['-C',release,'rev-parse','HEAD']);
  git(['-C',release,'push','public','public-release:refs/heads/main']);
  assert.equal(git(['--git-dir',publicRemote,'rev-parse','refs/heads/main']),updatedPublicSha);
  assert.equal(git(['--git-dir',publicRemote,'rev-list','--all','--count']),'2');
  assert.equal(git(['--git-dir',publicRemote,'show','refs/heads/main:public.txt']),'updated publishable fixture');
  git(['--git-dir',publicRemote,'cat-file','-e',`${updatedPrivateSha}^{commit}`],{expectFailure:true});
  for(const revision of git(['--git-dir',publicRemote,'rev-list','--all']).split(/\r?\n/)) {
    git(['--git-dir',publicRemote,'grep','-F','PRIVATE_SENTINEL_DO_NOT_PUBLISH',revision],{expectFailure:true});
    git(['--git-dir',publicRemote,'cat-file','-e',`${revision}:private.txt`],{expectFailure:true});
  }
  assert.deepEqual(git(['-C',local,'remote']).split(/\r?\n/).sort(),['origin','public']);
  console.log('双远程本地模拟通过：初始发布及后续选择性同步后，公开历史不含私有提交或模拟敏感文件。');
} finally {
  const resolved=await realpath(root).catch(()=>null);
  if(resolved && path.dirname(resolved)===tempRoot && path.basename(resolved).startsWith('tuxun-remotes-'))await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
