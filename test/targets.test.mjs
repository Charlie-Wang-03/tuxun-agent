import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveActionTarget, resolveMapSelection, mapControlName } from '../src/targets.mjs';

test('拖动街景时拒绝落在地图的终点', async () => {
  const kinds = ['panorama', 'map'];
  const a = { type: 'drag', x: .2, y: .4, endX: .8, endY: .7 };
  await assert.rejects(resolveActionTarget(null, a, 1000, 800, 70, async () => kinds.shift()), /终点不在街景/);
});

test('合法地图点击映射到实际页面坐标', async () => {
  const a = { type: 'click', x: .75, y: .5 };
  assert.deepEqual(await resolveActionTarget(null, a, 1000, 800, 70, async () => 'map'), { x: 750, y: 470, kind: 'map' });
});

test('展开地图上的悬停合法，街景上的悬停仍被拒绝', async () => {
  const action={type:'hover',x:.7,y:.5};
  assert.equal((await resolveActionTarget(null,action,1000,800,70,async()=> 'map','fixed-view')).kind,'map');
  await assert.rejects(resolveActionTarget(null,action,1000,800,70,async()=> 'panorama','fixed-view'),/不是允许/);
});

test('区分地图窗口大小、固定和内容缩放控件', () => {
  assert.equal(mapControlName('map', '扩大地图窗口'), '扩大地图窗口');
  assert.equal(mapControlName('map', '缩小地图窗口'), '缩小地图窗口');
  assert.equal(mapControlName('map', '固定或取消固定地图'), '固定或取消固定地图');
  assert.equal(mapControlName('zoom', '+'), '放大地图内容');
  assert.equal(mapControlName('zoom', '−'), '缩小地图内容');
  assert.equal(mapControlName('zoom', 2), null);
});

test('地图局部坐标准确转换到页面，并拒绝点击控件', async () => {
  const a={type:'map_select',x:.25,y:.75}, r={x:500,y:100,width:800,height:400};
  assert.deepEqual(await resolveMapSelection(null,a,r,async()=> 'map'),{x:700,y:400,kind:'map'});
  await assert.rejects(resolveMapSelection(null,a,r,async()=> 'map_control'), /不是地图/);
});

test('移动动作只在移动模式允许对应的街景目标', async () => {
  const a={type:'move_arrow',x:.5,y:.7};
  await assert.rejects(resolveActionTarget(null,a,1000,800,70,async()=> 'panorama_arrow'),/不是允许/);
  assert.equal((await resolveActionTarget(null,a,1000,800,70,async()=> 'panorama_arrow','move')).kind,'panorama_arrow');
  await assert.rejects(resolveActionTarget(null,{...a,type:'move_road'},1000,800,70,async()=> 'map','move'),/不是允许/);
});

test('固定视角按实际目标阻止街景缩放但允许地图缩放', async () => {
  const action={type:'scroll',x:.5,y:.5,delta:-120};
  await assert.rejects(resolveActionTarget(null,action,1000,800,70,async()=> 'panorama','fixed-view'),/不是允许/);
  assert.equal((await resolveActionTarget(null,action,1000,800,70,async()=> 'map','fixed-view')).kind,'map');
});
