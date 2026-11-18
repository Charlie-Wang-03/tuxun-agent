import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, modeLabel, streetModeInstructions } from '../src/mode.mjs';
import { createTrace } from '../src/trace.mjs';

test('固定视角提示明确禁止街景操作并保留地图操作',()=>{
  assert.ok(MODES.includes('fixed-view'));
  assert.equal(modeLabel('fixed-view'),'固定视角');
  const rules=streetModeInstructions('fixed-view');
  assert.match(rules.capability,/严禁移动、拖动转向或缩放街景/);
  assert.match(rules.controls,/仅可缩放地图/);
  assert.match(rules.strategy,/视角无法改变/);
  assert.match(rules.unavailable,/不能拖拽或缩放街景/);
});

test('运行轨迹显示固定视角模式',()=>{
  const lines=[];createTrace({write:s=>lines.push(s)}).event({kind:'started',mode:'fixed-view',runDir:'run'});
  assert.match(lines[0],/固定视角模式/);
});

test('固定模式提示明确允许原地转向缩放且禁止移步',()=>{
  const rules=streetModeInstructions('fixed');
  assert.match(rules.capability,/不可移步/);
  assert.match(rules.capability,/可以在原地拖动转向和缩放街景/);
  assert.match(rules.capability,/视角可以改变/);
  assert.doesNotMatch(rules.capability,/固定视角/);
  assert.match(rules.controls,/drag/);
});
