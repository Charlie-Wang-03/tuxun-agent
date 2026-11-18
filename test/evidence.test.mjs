import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EvidenceError, decodeScreenshot, inspectScreenshot, readScreenshot, writeFile, appendFile} from '../src/evidence.mjs';
import {mkdtemp, rm, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('所有截图编码或 PNG 解码异常具有硬停止类型和原始原因', () => {
  for (const data of [undefined,'','%%%=',Buffer.from('not PNG').toString('base64')]) assert.throws(()=>decodeScreenshot({data}),e=>e instanceof EvidenceError && e.cause instanceof Error);
  assert.throws(()=>inspectScreenshot(Buffer.from('broken')),EvidenceError);
});
test('实际文件缺失、写入目录、追加失败统一保留证据错误', async () => {
  const base=await realpath(tmpdir()),dir=await mkdtemp(path.join(base,'tuxun-evidence-'));
  try {
    await assert.rejects(readScreenshot(path.join(dir,'missing.png')),e=>e instanceof EvidenceError && e.cause.code==='ENOENT');
    await assert.rejects(writeFile(dir,Buffer.from('png')),EvidenceError);
    await assert.rejects(appendFile(path.join(dir,'missing','events.jsonl'),'{}'),EvidenceError);
    await writeFile(path.join(dir,'bad.png'),'corrupted');
    await assert.rejects(readScreenshot(path.join(dir,'bad.png')),EvidenceError);
  } finally {
    const resolved=await realpath(dir);
    if(path.dirname(resolved)===base && path.basename(resolved).startsWith('tuxun-evidence-'))await rm(resolved,{recursive:true,force:true});
  }
});
