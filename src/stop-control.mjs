// Prevent new browser input after a stop request; already-sent commands may complete.
export function createStopControl(onStop = () => {}) {
  let stopped = false;
  let source=null;
  return {
    stop(reason='用户请求') {
      if (stopped) return;
      stopped = true;
      source=reason;
      onStop();
    },
    get stopped() { return stopped; },
    get source() { return source; },
    check() {if(stopped)throw Error('用户已请求停止');},
    guard(method) {
      if (stopped && method.startsWith('Input.')) throw Error('用户已请求停止');
    }
  };
}

export function bindStopSignals(control, emitter=process) {
  const handlers=new Map(['SIGINT','SIGTERM'].map(signal=>[signal,()=>control.stop(signal)]));
  for(const [signal,handler] of handlers)emitter.on(signal,handler);
  return ()=>{for(const [signal,handler] of handlers)emitter.off(signal,handler);};
}
