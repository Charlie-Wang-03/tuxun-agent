import { modeLabel } from './mode.mjs';
const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
const actionNames = { hover:'展开地图', map_control:'调整地图控件', map_scroll:'缩放地图', map_select:'地图选点', select_and_review:'选点并请求核对', click:'点击', drag:'拖动街景', scroll:'缩放', move_arrow:'点击移动箭头', move_road:'点击道路', return_to_street:'返回观察街景', stop:'停止', finish:'结束' };
const targetNames = { map:'地图', confirm:'确认选择', panorama:'街景', panorama_arrow:'街景箭头', map_control:'地图控件' };
const number = v => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(3) : '?';

export function createTrace({ write = line => console.log(line), time = () => new Date() } = {}) {
  let lastRound = null;
  const output = (label, message) => write(`[${time().toLocaleTimeString('zh-CN', {hour12:false})}] ${label} ${clean(message)}`);
  return {
    progress(label, seconds) { output('等待', `${label}中，已耗时 ${seconds} 秒`); },
    event(event) {
      switch (event.kind) {
        case 'started': output('开始', `${modeLabel(event.mode)}模式；${event.limits?.games ?? 1} 局；记录目录：${event.runDir}${event.limits?`；单题 ${event.limits.roundSeconds} 秒 / ${event.limits.maxActions} 次，每局 ${event.limits.totalSeconds} 秒`:''}${event.verifyCurrent?'；仅验证已有选点':''}`); break;
        case 'state': if (`${event.game ?? 1}:${event.round}` !== lastRound) {lastRound=`${event.game ?? 1}:${event.round}`;output('题目', `第 ${event.game ?? 1} 局，第 ${event.round}/5 题，当前总分 ${event.score ?? '未知'}`);} break;
        case 'street_loading': output('街景', '等待画面加载'); break;
        case 'street_load_probe': if(event.elapsed_ms===0 || event.black || event.elapsed_ms>=5000) output('街景', `等待 ${Math.round(event.elapsed_ms/1000)} 秒，${event.black?'画面接近全黑':'画面未判为全黑'}`); break;
        case 'forced_mode': output('兜底', `优先提交当前选点：${event.trigger}`); break;
        case 'forced_selection_attempt': output('兜底', '无已有选点，使用可见地图中心；该点未经过地理推断'); break;
        case 'forced_submit_attempt': output('兜底', `即将提交${event.source==='existing_pin'?'当前选点':'地图中心兜底点'}，位置可能不准确`); break;
        case 'forced_submitted': output('兜底', '已提交，等待记录得分'); break;
        case 'endgame_started': output('收尾', `剩余约 ${Math.floor(event.remaining_ms/1000)} 秒，优先按已有线索选取宽泛区域并核对`); break;
        case 'approximate_submit_attempt': output('范围级结果', `核对仍不确定，按限时策略尝试提交；${event.reason}`); break;
        case 'approximate_submitted': output('范围级结果', '已提交不确定的区域性选点'); break;
        case 'model_start': output('模型', `${event.label}，请稍候`); break;
        case 'model_finished': output('模型', `${event.label}完成，耗时 ${(event.elapsed_ms/1000).toFixed(1)} 秒${event.tokens == null ? '；token 未提供' : `；token ${event.tokens}`}`); break;
        case 'decision': {
          const a=event.action, name=actionNames[a.type] ?? a.type;
          output('观察', a.observation);
          output('判断', a.reason);
          let detail = '';
          if (!['stop','finish','return_to_street'].includes(a.type)) detail = `；${['map_scroll','map_select','select_and_review'].includes(a.type)?'地图局部':'截图'}比例坐标 (${number(a.x)}, ${number(a.y)})`;
          if (a.type==='drag') detail += ` → (${number(a.endX)}, ${number(a.endY)})`;
          if (['scroll','map_scroll'].includes(a.type)) detail += `；滚轮 ${a.delta}`;
          if (a.control) detail += `；${a.control}`;
          output('计划', `${event.source==='automatic_review'?'程序发起核对并确认：':event.source==='automatic_recovery'?'程序恢复：':''}${name}${detail}${event.tokens===null?'':`；token ${event.tokens}`}`);
          break;
        }
        case 'rejected_decision': output('拦截', `动作未执行：${event.reason}`); break;
        case 'invalid_action_recovery': output('恢复', event.reason); break;
        case 'blind_audit': output('独立国家核对', `${event.certainty}；${event.country_code || '无法确认'}；${event.reason}`); break;
        case 'blind_audit_skipped': output('独立国家核对', `跳过：${event.reason}`); break;
        case 'selection_audit': output('选点核对', `${event.verdict}；${event.reason}${event.marker ? `；标记：${event.marker}` : ''}`); break;
        case 'audit_zoom_attempt': output('核对', '先放大图钉附近地图以观察边界'); break;
        case 'map_auto_expand': output('地图', '已扩大地图窗口以便定位'); break;
        case 'map_reframed': output('地图', '目标靠近边缘，先在对侧缩小，再观察地图'); break;
        case 'movement_attempt': output('移动', '准备点击一次并等待街景变化'); break;
        case 'movement_unconfirmed': output('移动', '未确认画面变化，不重复点击'); break;
        case 'movement_recovery': output('恢复', event.reason); break;
        case 'movement_load_probe': output('等待', event.black ? '街景接近全黑' : event.comparison?.changed ? '检测到画面变化' : '画面尚未明显变化'); break;
        case 'action_executed': output('完成', `${actionNames[event.type] ?? event.type}；目标：${targetNames[event.target] ?? event.target}${event.control ? `；${event.control}` : ''}`); break;
        case 'surface_check': if(event.surface==='likely_water') output('拦截', '选点附近呈蓝色水域'); break;
        case 'marker_check': output('标记', event.ok ? '可见图钉位于点击位置附近' : '图钉位置无法确认，需要重新选点'); break;
        case 'result': output('结果', `第 ${event.round} 题 ${event.points}/5000，距离 ${event.distance}，总分 ${event.score ?? '未知'}`); break;
        case 'next_round_verified': output('下一轮', `已从第 ${event.from} 题进入第 ${event.to} 题`); break;
        case 'game_completed': output('本局完成', `第 ${event.game} 局，总分 ${event.score ?? '未知'}`); break;
        case 'restart_attempt': output('再来一局', `正在从第 ${event.from} 局进入第 ${event.to} 局`); break;
        case 'restart_verified': output('再来一局', `已确认第 ${event.to} 局开始`); break;
        case 'submit_current': output('提交', '提交已有选点并等待结果'); break;
        case 'stopped': output('停止', event.reason); break;
      }
    }
  };
}
