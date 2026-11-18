import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCodexOutput,validateCodexAction} from '../src/codex-output.mjs';
import {emptySummary,updateSummary} from '../src/dashboard-summary.mjs';

test('解析结构化结果并区分总输入、缓存与输出',()=>{
 const out=[{type:'item.completed',item:{type:'agent_message',text:'{"type":"hover"}'}},{type:'turn.completed',usage:{input_tokens:10000,cached_input_tokens:6000,output_tokens:300,reasoning_output_tokens:120}}].map(JSON.stringify).join('\n');
 const r=parseCodexOutput(out);assert.equal(r.value.type,'hover');assert.equal(r.tokens,10300);assert.equal(r.usage.cached_input_tokens,6000);assert.equal(r.usage.reasoning_output_tokens,120);
});
test('动作无效时保留本次模型用量，供失败记录和界面统计',()=>{
 const usage={input_tokens:100,cached_input_tokens:40,output_tokens:7};
 let failure;
 try{validateCodexAction({value:{type:'unknown'},tokens:107,usage})}catch(error){failure=error}
 assert.match(failure.message,/模型输出无效/);
 assert.equal(failure.tokens,107);
 assert.deepEqual(failure.usage,usage);
 const summary=emptySummary();
 updateSummary(summary,{kind:'model_failed',tokens:failure.tokens,usage:failure.usage});
 assert.equal(summary.tokens,107);
 assert.equal(summary.structured,true);
 assert.equal(summary.legacy,false);
});
test('模型消息 JSON 无效时保留已收到的有效用量',()=>{
 const out=[{type:'item.completed',item:{type:'agent_message',text:'{invalid'}},{type:'turn.completed',usage:{input_tokens:10,cached_input_tokens:2,output_tokens:3}}].map(JSON.stringify).join('\n');
 let failure;
 try{parseCodexOutput(out)}catch(error){failure=error}
 assert.match(failure.message,/不是有效 JSON/);
 assert.equal(failure.tokens,13);
 assert.equal(failure.usage.cached_input_tokens,2);
});
test('拒绝缺失最终结果、缺失用量或不合理的缓存计数',()=>{
 assert.throws(()=>parseCodexOutput('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'));
 assert.throws(()=>parseCodexOutput([{type:'item.completed',item:{type:'agent_message',text:'{}'}},{type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:2,output_tokens:1}}].map(JSON.stringify).join('\n')));
});
