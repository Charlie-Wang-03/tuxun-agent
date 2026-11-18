export const MODES = Object.freeze(['fixed', 'move', 'fixed-view']);
export class ModeUnconfirmedError extends Error {}

export function modeLabel(mode) {
  const labels = { fixed: '固定', move: '移动', 'fixed-view': '固定视角' };
  if (!labels[mode]) throw Error('未知模式');
  return labels[mode];
}

export function streetModeInstructions(mode) {
  if (mode === 'fixed-view') return {
    capability: '固定视角只有一张街景图：严禁移动、拖动转向或缩放街景。根据当前画面与方位判断，尽快展开地图并选点。',
    controls: 'scroll 仅可缩放地图；',
    strategy: '街景视角无法改变，不要尝试寻找其他视角。根据现有线索选择合理的宽泛候选，然后展开地图、选点并确认。',
    unavailable: '当前地图局部图不可用：使用 hover 展开地图，不能拖拽或缩放街景。'
  };
  return {
    capability: mode === 'move' ? '可以移动：move_arrow 点击画面下方可见的前进或后退箭头；move_road 指定可见道路位置；程序会先悬停并记录可能出现的圆框前进箭头，再在同一位置左键点击一次。每次移动后重新观察画面；若连续三次移动未发现新的可辨认线索，应考虑按现有证据选取较大区域，避免无目的行走；坐标均相对第一张图。' : '当前是固定模式：不可移步，但可以在原地拖动转向和缩放街景。视角可以改变，可以观察同一位置的不同方向。',
    controls: 'drag 只可上下左右拖动街景；scroll 可缩放街景或地图；街景缩放使用 -120 或 120。',
    strategy: '如果初始景观没有可辨识文字或独特线索、存在多个相距遥远的候选地区，优先原地转动视角至少一次再决定区域；在预算紧张时直接按现有证据选点。查看街景及居中方位后可拖拽或缩放寻找线索，再悬停展开地图，调整地图大小、选点并确认。',
    unavailable: '当前地图局部图不可用：如需在地图上选点或缩放，先使用 hover 展开地图；仍可拖拽或缩放街景寻找线索。'
  };
}
