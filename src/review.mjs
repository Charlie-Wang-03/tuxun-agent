import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';

import {parseEvents, summarizeEvents} from './review-data.mjs';
export {parseEvents, summarizeEvents} from './review-data.mjs';

const clean = x => String(x ?? '未知').replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').replace(/\s+/g,' ').trim();
const show = x => x===null||x===undefined?'未知':clean(x);
export function formatReview(s,dir) {
  const lastResult=[...s.games.values()].flat().filter(r=>r.result).at(-1)?.result;
  const lines=[`运行目录：${clean(dir)}`,`模式：${show(({fixed:'固定',move:'移动','fixed-view':'固定视角'})[s.mode] ?? s.mode)}；状态：${s.stopped?clean(s.stopped):'未知（没有停止记录）'}；已记录结果：${s.resultCount}/${s.plannedGames*5}；最近一局记录总分：${show(lastResult?.score)}；总耗时：${s.elapsed===null?'未知':s.elapsed+' 秒'}`];
  const mixed=s.usage.structuredCalls>0&&s.usage.legacyCalls>0;
  for(const [game,rounds] of s.games) { if(s.plannedGames>1||s.games.size>1)lines.push(`第 ${game} 局：`); for(const r of rounds) {
    if(!r.result){lines.push(`第 ${r.round} 题：结果未知（未记录）${r.modelCalls?`；已有模型调用 ${r.modelCalls} 次`:''}`);continue;}
    const source=({existing_pin:'已有图钉',map_center:'地图中心'})[r.result.forced_detail?.source] ?? r.result.forced_detail?.source;
    const f=r.result.forced===true?`兜底：${show(source)}，${show(r.result.forced_detail?.trigger)}`:r.result.forced===false?(r.result.approximate?'范围级不确定':'未标记兜底'):'兜底状态未知';
    lines.push(`第 ${r.round} 题：${show(r.result.points)}/5000；距离 ${show(r.result.distance)}；耗时 ${r.elapsed===null?'未知':r.elapsed+' 秒'}；模型调用 ${r.modelCalls} 次；记录 token ${mixed?'口径混合':r.tokenKnownCalls?r.tokenTotal:'未知'}${r.missingTokens?`（${r.missingTokens} 次未知）`:''}；${f}`);
  }}
  lines.push(`模型调用：${s.modelCalls} 次（失败 ${s.failed} 次${s.unknownRoundCalls?`；${s.unknownRoundCalls} 次题号未知`:''}）；模型耗时：${s.modelMs/1000} 秒${s.missingDurationCalls?`（${s.missingDurationCalls} 次耗时未知）`:''}`);
  lines.push(`记录的 token：${mixed?'不可合并':s.knownTokenCalls?s.knownTokens:'未知'}${s.usage.missingCalls?`（${s.usage.missingCalls} 次用量未知）`:''}；统计口径：${mixed?'混合，不宜比较':s.usage.structuredCalls?'输入加输出，输入包含缓存':s.usage.legacyCalls?'旧版 CLI 记录':'未知'}；不等同于费用`);
  if(s.usage.structuredCalls)lines.push(`结构化用量（${s.usage.structuredCalls} 次）：输入 ${s.usage.input}，其中缓存 ${s.usage.cached}，输出 ${s.usage.output}${s.usage.legacyCalls||s.usage.missingCalls?'；未覆盖全部调用':''}`);
  if(s.issues.length){lines.push('异常与拦截：');for(const i of s.issues)lines.push(`- ${s.plannedGames>1||s.games.size>1?`第 ${show(i.game)} 局 `:''}第 ${show(i.round)} 题 ${clean(i.kind)}：${clean(i.reason)}`);}else lines.push('异常与拦截：未记录');
  if(s.truncated)lines.push('注意：忽略了末尾未完成的日志行，统计可能不完整。');
  return lines.join('\n');
}

export async function findLatestRun(runsDir) {
  const entries=await readdir(runsDir,{withFileTypes:true});
  const names=entries.filter(e=>e.isDirectory() && /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/.test(e.name)).map(e=>e.name).sort().reverse();
  if(!names.length)throw Error('没有找到运行目录；请指定包含 events.jsonl 的目录');
  return path.join(runsDir,names[0]);
}

export async function reviewRun(dir) {
  const file=path.join(dir,'events.jsonl');
  let text;try{text=await readFile(file,'utf8')}catch(e){throw Error(`无法读取事件日志 ${file}：${e.message}`)}
  const parsed=parseEvents(text);return formatReview(summarizeEvents(parsed.events,parsed),dir);
}
