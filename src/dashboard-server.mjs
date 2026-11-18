import http from 'node:http';
import {fork} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFile, realpath, open} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureFrame} from './dashboard-frame.mjs';
import {parseRunOptions} from './run-options.mjs';
import {emptySummary, updateSummary} from './dashboard-summary.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = new Map(['dashboard-i18n.mjs', 'dashboard-preferences.mjs', 'dashboard.css', 'dashboard-client.mjs', 'dashboard-model.mjs', 'dashboard-summary.mjs', 'review-data.mjs'].map(name => [`/${name}`, name]));
export async function readCurrentEvents(runDir, runsRoot = path.join(root, 'artifacts', 'runs')) {
  if (!runDir) throw Error('尚无本次运行目录');
  const resolvedRoot = await realpath(runsRoot), resolvedRun = await realpath(runDir);
  if (path.dirname(resolvedRun) !== resolvedRoot || !/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/.test(path.basename(resolvedRun))) throw Error('运行目录不在本项目记录范围内');
  const file = await realpath(path.join(resolvedRun, 'events.jsonl'));
  if (path.dirname(file) !== resolvedRun) throw Error('事件日志不能指向运行目录之外');
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 32*1024*1024) throw Error('日志超过在线查看范围，请在复盘中选择本地目录');
    // Bounded snapshot: a concurrent append may leave an incomplete last line.
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const {bytesRead} = await handle.read(buffer, offset, buffer.length-offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    return buffer.subarray(0,offset).toString('utf8');
  } finally { await handle.close(); }
}

export function createDashboardServer({launchWorker = args => fork(path.join(root, 'src', 'cli.mjs'), ['run', ...args], {cwd:root, silent:true, windowsHide:true}), capture = captureFrame, readEvents = readCurrentEvents} = {}) {
  const token = randomBytes(24).toString('hex');
  let worker = null, stopping = false, stopError = null, events = [], lines = [], outcome = '尚未启动', runId = null;
  let summary = emptySummary();
  function acceptEvent(event) {
    updateSummary(summary, event);
    events.push(event); events = events.slice(-500);
  }

  function body(req) {
    return new Promise((resolve, reject) => {
      let data = ''; req.setEncoding('utf8');
      req.on('data', chunk => { data += chunk; if (data.length > 8192) { reject(Error('请求过大')); req.destroy(); } });
      req.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(Error('请求格式无效')); } });
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    const host = `127.0.0.1:${server.address().port}`;
    const send = (status, value) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff'}); res.end(JSON.stringify(value)); };
    if (req.headers.host !== host) return send(403, {error:'无效的主机'});
    try {
      const url = new URL(req.url, `http://${host}`);
      if (req.method === 'GET' && url.pathname === '/') {
        const html = await readFile(path.join(root, 'src', 'dashboard.html'), 'utf8');
        res.writeHead(200, {'content-type':'text/html; charset=utf-8', 'cache-control':'no-store', 'content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'", 'x-content-type-options':'nosniff'});
        return res.end(html.replace('__DASHBOARD_TOKEN__', token));
      }
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const name = assets.get(url.pathname);
        const asset = await readFile(path.join(root, 'src', name));
        res.writeHead(200, {'content-type':name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff'});
        return res.end(asset);
      }
      if (req.headers['x-dashboard-token'] !== token || (req.method !== 'GET' && req.headers.origin !== `http://${host}`)) return send(403, {error:'请求未获授权'});
      if (req.method === 'GET' && url.pathname === '/api/status') return send(200, {runId, running:!!worker, stopping, stopError, outcome, summary, events, lines});
      if (req.method === 'GET' && url.pathname === '/api/events') {
        const requestedRun = url.searchParams.get('run');
        if (!runId || requestedRun !== runId) return send(409, {error:'运行记录已切换，请刷新状态后重试'});
        const log = await readEvents(summary.started?.runDir);
        if (requestedRun !== runId) return send(409, {error:'读取期间已开始新运行，请重新载入'});
        res.writeHead(200, {'content-type':'text/plain; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff'});
        return res.end(log);
      }
      if (req.method === 'GET' && url.pathname === '/api/frame') { const image = await capture(); res.writeHead(200, {'content-type':'image/jpeg', 'cache-control':'no-store', 'x-content-type-options':'nosniff'}); return res.end(image); }
      if (req.method === 'POST' && url.pathname === '/api/start') {
        if (worker) return send(409, {error:'已有运行'});
        const data = await body(req);
        if (worker) return send(409, {error:'已有运行'});
        if (data.confirm !== true) return send(400, {error:'请确认真实游戏及预算'});
        const args = ['--mode', String(data.mode), '--round-seconds', String(data.roundSeconds), '--total-seconds', String(data.totalSeconds), '--max-actions', String(data.maxActions)];
        if (data.games != null) args.push('--games', String(data.games));
        if (data.initialRoundSeconds != null) args.push('--initial-round-seconds', String(data.initialRoundSeconds));
        parseRunOptions(args);
        events = []; lines = []; summary = emptySummary(); stopping = false; stopError = null; outcome = '正在启动'; runId = randomBytes(8).toString('hex');
        const child = launchWorker(args); worker = child;
        let childError = null;
        for (const stream of [child.stdout,child.stderr]) {
          const reader=createInterface({input:stream,crlfDelay:Infinity});
          reader.on('line',line=>{if(line){lines.push(line);lines=lines.slice(-120)}});
        }
        child.on('message', message => { if (message?.type === 'event') acceptEvent(message.event); });
        child.on('error', error => { childError = error.message; outcome = `运行进程错误：${error.message}；提交状态未知`; });
        child.on('close', (code, signal) => { outcome = events.findLast(e => e.kind === 'stopped')?.reason ?? (childError ? `运行进程错误：${childError}；提交状态未知` : `进程结束（${signal ?? code}）；提交状态未知`); worker = null; stopping = false; stopError = null; });
        return send(202, {started:true});
      }
      if (req.method === 'POST' && url.pathname === '/api/stop') {
        if (!worker || !worker.connected) return send(409, {error:'没有可停止的运行，提交状态可能未知'});
        if (stopping) return send(409, {error:'停止请求正在处理'});
        stopping = true; stopError = null; const current = worker;
        try {
          current.send({type:'stop'}, error => { if (error && worker === current) { stopping = false; stopError = `停止请求未送达：${error.message}；提交状态未知`; } });
        } catch (error) {
          stopping = false; stopError = `停止请求未送达：${error.message}；提交状态未知`;
          return send(500, {error:stopError});
        }
        return send(202, {stopping:true});
      }
      return send(404, {error:'未找到'});
    } catch (error) { if (!res.headersSent) send(400, {error:error.message}); }
  });
  return server;
}
