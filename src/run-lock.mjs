import net from 'node:net';

// OS-owned endpoints disappear on process exit; there is no stale PID file to
// delete, and separate checkouts controlling the same port share this lock.
export function runLockAddress(port, platform=process.platform) {
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('调试端口无效');
  if(platform==='win32')return `\\\\.\\pipe\\tuxun-agent-browser-${port}`;
  if(platform==='linux')return `\0tuxun-agent-browser-${port}`;
  throw Error('当前平台不支持运行互斥锁');
}

export async function acquireRunLock(port) {
  const server=net.createServer(socket=>socket.destroy());
  try {
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(runLockAddress(port),()=>{server.off('error',reject);resolve();});
    });
  } catch(error) {
    server.close();
    if(['EADDRINUSE','EACCES'].includes(error.code))throw Error(`专用浏览器端口 ${port} 已被另一运行占用或无法取得互斥锁；未连接浏览器`);
    throw error;
  }
  let released=false;
  return async()=>{
    if(released)return;
    released=true;
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  };
}
