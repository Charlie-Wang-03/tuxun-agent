export class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.closed = false;
    ws.addEventListener('message', e => {
      if(this.closed)return;
      let message;
      try {
        message=JSON.parse(e.data);
        if(!message || typeof message!=='object' || Array.isArray(message))throw Error('不是协议对象');
      } catch { this.close(Error('浏览器调试消息无效'));return; }
      const pending=this.pending.get(message.id);
      if(!pending)return;
      this.pending.delete(message.id);
      message.error ? pending.reject(Error(message.error.message)) : pending.resolve(message.result);
    });
    ws.addEventListener('error',()=>this.close(Error('浏览器调试连接错误')));
    ws.addEventListener('close',()=>this.rejectPending(Error('浏览器连接已关闭')));
  }
  rejectPending(error) {
    this.closed=true;
    for(const pending of this.pending.values())pending.reject(error);
    this.pending.clear();
  }
  static async connect(url, timeoutMs = 3000) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { try { ws.close(); } catch {} reject(Error('连接浏览器调试端口超时')); }, timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once:true});
      ws.addEventListener('error', () => { clearTimeout(timer); reject(Error('无法连接浏览器调试端口')); }, {once:true});
    });
    return new CDP(ws);
  }
  call(method, params = {}, timeoutMs = 10000) { return new Promise((resolve, reject) => { if(this.closed)return reject(Error('浏览器连接已关闭'));const id = ++this.id; const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`${method}: 浏览器响应超时`)); }, timeoutMs); this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); try { this.ws.send(JSON.stringify({ id, method, params })); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } }); }
  close(error=Error('浏览器连接已关闭')) {
    if(this.closed)return;
    this.rejectPending(error);
    try {this.ws.close();} catch {}
  }
}
