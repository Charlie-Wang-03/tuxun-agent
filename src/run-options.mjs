import {DEFAULTS} from './policy.mjs';
import {MODES} from './mode.mjs';
export const DEFAULT_MODEL_CONFIG = Object.freeze({model:'gpt-6-astra', reasoning_effort:'high'});
export const REASONING_EFFORTS = Object.freeze(['none','minimal','low','medium','high','xhigh']);
export const MODEL_NAME_PATTERN = '[A-Za-z0-9][A-Za-z0-9._:\\x2F\\x2D]{0,127}';
const validModelName = new RegExp(`^${MODEL_NAME_PATTERN}$`, 'u');
export const RUN_HELP=`用法：npm run run -- [--mode fixed|move|fixed-view] [--games 局数] [--round-seconds 秒] [--total-seconds 秒] [--max-actions 次] [--model 模型名] [--reasoning-effort ${REASONING_EFFORTS.join('|')}] [--verify-current]\n默认模型 ${DEFAULT_MODEL_CONFIG.model}，推理强度 ${DEFAULT_MODEL_CONFIG.reasoning_effort}。默认一局（五题），单局时间上限在每局重新计算。请先手动开始经典五题并运行 npm run headless；模式参数须与网页选择一致。`;
export function parseRunOptions(opts) {
  const limits={...DEFAULTS,games:1};let verifyCurrent=false,mode='fixed';
  const modelConfig = {...DEFAULT_MODEL_CONFIG};
  const keys={'--games':'games','--round-seconds':'roundSeconds','--total-seconds':'totalSeconds','--max-actions':'maxActions','--initial-round-seconds':'initialRoundSeconds','--initial-max-actions':'initialMaxActions'};
  for(let i=0;i<opts.length;i++){
    const opt=opts[i];if(opt==='--help')return {help:true};if(opt==='--verify-current'){verifyCurrent=true;continue;}
    if(opt==='--mode'){mode=opts[++i];if(!MODES.includes(mode))throw Error('模式必须为 fixed、move 或 fixed-view；运行 npm run run -- --help 查看用法');continue;}
    if (opt === '--model') {
      const name = opts[++i];
      if (typeof name !== 'string' || !validModelName.test(name)) throw Error('--model 需要有效的模型标识');
      modelConfig.model = name;
      continue;
    }
    if (opt === '--reasoning-effort') {
      const effort = opts[++i];
      if (!REASONING_EFFORTS.includes(effort)) throw Error(`--reasoning-effort 可选值为 ${REASONING_EFFORTS.join(', ')}`);
      modelConfig.reasoning_effort = effort;
      continue;
    }
    if(!Object.hasOwn(keys,opt))throw Error(`未知参数 ${opt}；运行 npm run run -- --help 查看用法`);
    const value=opts[++i],n=Number(value);if(value===undefined||!Number.isSafeInteger(n)||n<1)throw Error(`${opt} 需要正整数；运行 npm run run -- --help 查看用法`);
    limits[keys[opt]]=n;
  }
  if(limits.initialRoundSeconds>limits.roundSeconds)throw Error('首题剩余时间不能超过单题预算');
  if(limits.initialMaxActions>limits.maxActions)throw Error('首题剩余操作不能超过单题预算');
  if(verifyCurrent && limits.games!==1)throw Error('验证当前选点不能与多局模式同时使用');
  return {limits,mode,verifyCurrent,modelConfig:Object.freeze(modelConfig),help:false};
}
