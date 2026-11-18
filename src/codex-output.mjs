import {validateAction} from './policy.mjs';

function usageFromCompleted(completed) {
  const u=completed.usage;
  if (!u || !Number.isFinite(u.input_tokens) || !Number.isFinite(u.output_tokens) || u.input_tokens<0 || u.output_tokens<0) throw Error('Codex 用量无效');
  const cached=u.cached_input_tokens ?? 0;
  if (!Number.isFinite(cached) || cached<0 || cached>u.input_tokens) throw Error('Codex 缓存用量无效');
  const usage={input_tokens:u.input_tokens,cached_input_tokens:cached,output_tokens:u.output_tokens,reasoning_output_tokens:u.reasoning_output_tokens ?? null};
  return {tokens:u.input_tokens+u.output_tokens,usage};
}

// A complete turn.completed event is evidence even if shutdown truncates a later line.
export function completedUsageFromPartial(output) {
  const lines=output.split(/\r?\n/),events=[];
  for(let i=0;i<lines.length;i++) {
    if(!lines[i].trim())continue;
    try { events.push(JSON.parse(lines[i])); }
    catch { if(i===lines.length-1&&!output.endsWith('\n'))break; return null; }
  }
  const completed=events.filter(e=>e?.type==='turn.completed').at(-1);
  if(!completed)return null;
  try{return usageFromCompleted(completed)}catch{return null}
}

// Codex JSONL distinguishes total input, cached input and output. Do not infer price.
export function parseCodexOutput(output) {
  const events = output.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  const completed = events.filter(e=>e.type==='turn.completed').at(-1);
  const message = events.filter(e=>e.type==='item.completed' && e.item?.type==='agent_message').at(-1);
  if (!completed || !message || typeof message.item.text!=='string') throw Error('Codex 未返回完整的结果和用量');
  const {tokens,usage}=usageFromCompleted(completed);
  try { return {value:JSON.parse(message.item.text),tokens,usage}; }
  catch (cause) { const error=Error(`模型结果不是有效 JSON: ${cause.message}`); error.tokens=tokens; error.usage=usage; throw error; }
}

export function validateCodexAction(result, mode = 'fixed') {
  try { return {action:validateAction(result.value, mode),tokens:result.tokens,usage:result.usage}; }
  catch (cause) {
    const value=result.value;
    const error=Error(`模型输出无效: ${cause.message}; type=${value?.type}, x=${value?.x}, y=${value?.y}`);
    error.tokens=result.tokens;
    error.usage=result.usage;
    throw error;
  }
}
