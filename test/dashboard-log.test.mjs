import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readCurrentEvents} from '../src/dashboard-server.mjs';

test('完整日志只读取当前项目的时间戳运行目录，不允许任意路径或目录',async()=>{
  const base=await realpath(tmpdir()),temp=await mkdtemp(path.join(base,'tuxun-event-read-'));
  try {
    const runs=path.join(temp,'runs'),run=path.join(runs,'2026-11-11T00-00-00-000Z');await mkdir(run,{recursive:true});
    const log='{"kind":"started"}\n{"kind":';await writeFile(path.join(run,'events.jsonl'),log);
    assert.equal(await readCurrentEvents(run,runs),log,'完整快照保留未完成尾行');
    await assert.rejects(readCurrentEvents(null,runs),/尚无/);
    await assert.rejects(readCurrentEvents(temp,runs),/范围/);
    const invalid=path.join(runs,'other');await mkdir(invalid);await writeFile(path.join(invalid,'events.jsonl'),'private');
    await assert.rejects(readCurrentEvents(invalid,runs),/范围/);
    const directory=path.join(runs,'2026-11-12T00-00-00-000Z');await mkdir(path.join(directory,'events.jsonl'),{recursive:true});
    await assert.rejects(readCurrentEvents(directory,runs));
  } finally {
    const resolved=await realpath(temp);if(path.dirname(resolved)===base&&path.basename(resolved).startsWith('tuxun-event-read-'))await rm(resolved,{recursive:true,force:true});
  }
});
