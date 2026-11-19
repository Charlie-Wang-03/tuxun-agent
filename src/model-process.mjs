import {parseCodexOutput,completedUsageFromPartial} from './codex-output.mjs';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export function resolveCodexRuntime({platform=process.platform, arch=process.arch, spawn=spawnSync}={}) {
  const targets = {x64:'x86_64-pc-windows-msvc', arm64:'aarch64-pc-windows-msvc'};
  if (platform !== 'win32' || !Object.hasOwn(targets, arch)) throw Error('项目 Codex CLI 需要 Windows x64 或 arm64');
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const version = manifest.dependencies['@openai/codex'];
  const executable = fileURLToPath(new URL(
    `../node_modules/@openai/codex-win32-${arch}/vendor/${targets[arch]}/bin/codex.exe`, import.meta.url));
  const probe = spawn(executable, ['--version'], {encoding:'utf8', timeout:5000, windowsHide:true});
  if (probe.status !== 0 || probe.stdout.trim() !== `codex-cli ${version}`) {
    throw Error(`需要项目本地 Codex CLI ${version}；请在项目根目录运行 npm install --ignore-scripts，再运行 npm run doctor`);
  }
  return {version, executable};
}

// Stop waiting as soon as cancellation is requested; the remote model outcome may be unknown.
export function readModelProcess(child, {timeoutMs, signal} = {}) {
  return new Promise((resolve, reject) => {
    let out='', err='', settled=false, timer;
    const finish=(fn,value)=>{
      if(settled)return;
      settled=true; clearTimeout(timer); signal?.removeEventListener('abort',abort);
      fn(value);
    };
    const fail=error=>{
      const known=completedUsageFromPartial(out);
      if(known){error.tokens=known.tokens;error.usage=known.usage;}
      finish(reject,error);
    };
    const terminate=reason=>{
      try { child.kill(); } catch {}
      child.stdout?.destroy(); child.stderr?.destroy();
      fail(Error(reason));
    };
    const abort=()=>terminate('用户已请求停止');
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data',d=>out+=d);
    child.stderr.on('data',d=>err=(err+d).slice(-1000));
    child.on('error',fail);
    child.on('close',code=>{
      if(settled)return;
      if(code!==0)return fail(Error(`Codex 失败 (${code}): ${err.slice(-1000)}`));
      try { finish(resolve,parseCodexOutput(out)); }
      catch(cause) { const error=Error(`模型输出无效: ${cause.message}`); error.tokens=cause.tokens; error.usage=cause.usage; fail(error); }
    });
    timer=setTimeout(()=>terminate('模型调用超时'),Math.max(1,timeoutMs));
    if(signal?.aborted)abort(); else signal?.addEventListener('abort',abort,{once:true});
  });
}
