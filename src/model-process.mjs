import {parseCodexOutput,completedUsageFromPartial} from './codex-output.mjs';

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
