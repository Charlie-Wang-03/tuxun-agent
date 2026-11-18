import {statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function assessEnvironment({platform,nodeVersion,chromePath,codex}) {
  const major=Number(String(nodeVersion).replace(/^v/,'').split('.')[0]);
  return [
    {name:'操作系统',status:platform==='win32'?'ok':'unsupported',detail:platform==='win32'?'Windows':'当前项目仅验证 Windows'},
    {name:'Node.js',status:Number.isInteger(major)&&major>=22?'ok':'unsupported',detail:`${nodeVersion}（需要 22 或更高）`},
    {name:'Chrome',status:chromePath?'ok':'missing',detail:chromePath?`${chromePath}（文件存在，未验证启动）`:'未找到；请安装 Google Chrome 或设置 CHROME_PATH'},
    {name:'Codex CLI',status:codex.ok?'ok':'missing',detail:codex.ok?codex.version:'无法执行 codex --version；请检查安装和 PATH'},
    {name:'Codex 登录状态',status:'unknown',detail:'未检查；请按 Codex CLI 的登录流程自行确认'}
  ];
}

const isFile = path => { try { return statSync(path).isFile(); } catch { return false; } };
export function runDiagnostics({platform=process.platform,nodeVersion=process.version,env=process.env,exists=isFile,spawn=spawnSync}={}) {
  const candidates=[env.CHROME_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
  const chromePath=candidates.find(exists)||null;
  const probe=spawn('codex',['--version'],{encoding:'utf8',timeout:5000,windowsHide:true});
  const version=probe.status===0 ? String(probe.stdout||'').trim().split(/\r?\n/).at(-1) : '';
  return assessEnvironment({platform,nodeVersion,chromePath,codex:{ok:!!version,version}});
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const rows=runDiagnostics();
  for(const row of rows)console.log(`[${({ok:'通过',missing:'未找到',unsupported:'不支持',unknown:'未验证'})[row.status]}] ${row.name}：${row.detail}`);
  console.log('此检查不登录、访问图寻、调用模型或确认费用。');
  if(rows.some(row=>row.status==='missing'||row.status==='unsupported'))process.exitCode=1;
}
