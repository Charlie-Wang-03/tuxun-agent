import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedPage, checkLimits, validateAction, isAllowedTarget, dragPoints, scrollPixels } from '../src/policy.mjs';

test('只允许题库经典五题页面，排除其他页面', () => { const url = 'https://tuxun.fun/challenge/00000000-0000-4000-8000-000000000000'; const title = '题库经典五题 - 图寻 - 探索世界'; assert.equal(allowedPage(url, title), true); assert.equal(allowedPage(url, '每日挑战'), false); assert.equal(allowedPage('https://tuxun.fun/map/12345', title), false); assert.equal(allowedPage('https://evil.example/challenge/00000000-0000-4000-8000-000000000000', title), false); });
test('拒绝无效或超出范围的动作', () => { assert.throws(() => validateAction({ type: 'click', x: 1.1, y: 0, reason: '' })); assert.throws(() => validateAction({ type: 'scroll', x: 0, y: 0, delta: 0, reason: '' })); });
test('达到限制时停止', () => { assert.equal(checkLimits({start: 0, roundStart: 0, actions: 0, rounds: 0}, 300000), '单题时间上限'); assert.equal(checkLimits({start: 0, roundStart: 0, actions: 35, rounds: 0}, 1), '单题操作上限'); });
test('按可见控件类型约束动作，禁止拖动地图', () => { assert.equal(isAllowedTarget('drag', 'map'), false); assert.equal(isAllowedTarget('drag', 'panorama'), true); assert.equal(isAllowedTarget('click', 'panorama'), false); assert.equal(isAllowedTarget('click', 'map'), true); assert.equal(isAllowedTarget('map_control', 'map'), false); assert.equal(isAllowedTarget('map_control', 'map_control'), true); });
test('移动动作仅在移动模式允许，固定模式拒绝', () => { const a={type:'move_road',x:.5,y:.6,reason:'前进'}; assert.throws(()=>validateAction(a,'fixed'),/固定模式/); assert.doesNotThrow(()=>validateAction(a,'move')); assert.equal(isAllowedTarget('move_road','panorama','fixed'),false); assert.equal(isAllowedTarget('move_road','panorama','move'),true); assert.equal(isAllowedTarget('move_arrow','panorama_arrow','move'),true); assert.equal(isAllowedTarget('move_arrow','map','move'),false); });
test('固定视角禁止转向、移动和街景滚轮，允许地图缩放及选点', () => {
  const drag={type:'drag',x:.2,y:.3,endX:.4,endY:.5,reason:'转向'};
  assert.throws(()=>validateAction(drag,'fixed-view'),/固定视角/);
  assert.throws(()=>validateAction({type:'move_road',x:.5,y:.5,reason:'前进'},'fixed-view'),/不允许移步/);
  for (const target of ['panorama','panorama_arrow']) {
    assert.equal(isAllowedTarget('scroll',target,'fixed-view'),false);
    assert.equal(isAllowedTarget('drag',target,'fixed-view'),false);
  }
  assert.equal(isAllowedTarget('scroll','map','fixed-view'),true);
  assert.equal(isAllowedTarget('map_scroll','map','fixed-view'),true);
  assert.equal(isAllowedTarget('select_and_review','map','fixed-view'),true);
  assert.equal(isAllowedTarget('scroll','panorama','fixed'),true);
  assert.doesNotThrow(()=>validateAction(drag,'fixed'));
});
test('悬停位置可以位于展开地图，目标仍需页面检查', () => { assert.doesNotThrow(() => validateAction({type:'hover',x:0.7,y:0.5,reason:'查看地图'})); });
test('街景拖拽生成连续轨迹并到达目标', () => { const p=dragPoints(100,200,180,120); assert.equal(p.length,8); assert.deepEqual(p[0],{x:110,y:190}); assert.deepEqual(p.at(-1),{x:180,y:120}); });
test('将滚轮输入标准化为有界的缩放操作', () => { assert.equal(scrollPixels(-5), -120); assert.equal(scrollPixels(300), 300); assert.equal(scrollPixels(-1200), -600); assert.throws(() => scrollPixels(0)); });

test('局部地图缩放必须提供有效滚轮量并限制目标', () => {
  const a={type:'map_scroll',x:.5,y:.5,delta:-360,reason:'放大地图'};
  assert.equal(validateAction(a),a);
  assert.equal(isAllowedTarget('map_scroll','map'),true);
  assert.equal(isAllowedTarget('map_scroll','panorama'),false);
  assert.throws(()=>validateAction({...a,delta:0}),/滚动量无效/);
});
