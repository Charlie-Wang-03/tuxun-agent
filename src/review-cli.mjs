import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {findLatestRun,reviewRun} from './review.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try {
  if(process.argv.length>3 || process.argv[2]?.startsWith('--'))throw Error('用法：npm run review -- [运行目录]');
  const dir=process.argv[2]?path.resolve(process.argv[2]):await findLatestRun(path.join(root,'artifacts','runs'));
  console.log(await reviewRun(dir));
} catch(e){console.error(`复盘失败：${e.message}`);process.exitCode=1;}
