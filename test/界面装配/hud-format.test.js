/**
 * 界面装配层内测试：HUD 纯格式化函数。
 *
 * 这些函数不访问 DOM，可直接在 Node 中运行；用于锁定罗盘方位约定、存活时间格式、
 * 敌人中文名与刻度生成，避免 HUD 展示逻辑在后续修改中悄悄偏移。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCompassTicks,
  damageDirectionDegrees,
  enemyTypeLabel,
  formatHeading,
  formatSurvivedTime,
  yawToHeading
} from '../../src/interface/impl/hud.js';

test('yaw 0 朝向 -Z，按北 0° 显示', () => {
  assert.equal(yawToHeading(0), 0);
});

test('鼠标右移使 yaw 减小、方位角增大', () => {
  assert.ok(Math.abs(yawToHeading(-Math.PI / 2) - 90) < 1e-9);
  assert.ok(Math.abs(yawToHeading(Math.PI / 2) - 270) < 1e-9);
});

test('方位角在 0–360 之间环绕', () => {
  assert.ok(Math.abs(yawToHeading(Math.PI) - 180) < 1e-9);
  assert.ok(Math.abs(yawToHeading(-Math.PI) - 180) < 1e-9);
  assert.ok(Math.abs(yawToHeading(3 * Math.PI) - 180) < 1e-9);
  assert.equal(yawToHeading(-2 * Math.PI), 0);
});

test('yawToHeading 拒绝非法输入', () => {
  assert.throws(() => yawToHeading(Number.NaN), TypeError);
  assert.throws(() => yawToHeading('0'), TypeError);
});

test('方位角格式化为三位度数', () => {
  assert.equal(formatHeading(0), '000°');
  assert.equal(formatHeading(90.2), '090°');
  assert.equal(formatHeading(359.4), '359°');
  assert.equal(formatHeading(359.7), '000°');
  assert.equal(formatHeading(-10), '350°');
});

test('存活时间格式化为 分:秒', () => {
  assert.equal(formatSurvivedTime(0), '0:00');
  assert.equal(formatSurvivedTime(9.9), '0:09');
  assert.equal(formatSurvivedTime(65), '1:05');
  assert.equal(formatSurvivedTime(600), '10:00');
  assert.equal(formatSurvivedTime(3599), '59:59');
});

test('存活时间拒绝负数与非法值', () => {
  assert.throws(() => formatSurvivedTime(-1), TypeError);
  assert.throws(() => formatSurvivedTime(Number.POSITIVE_INFINITY), TypeError);
});

test('敌人类型显示为约定中文名（v3 人类士兵）', () => {
  assert.equal(enemyTypeLabel('rifleman'), '步枪兵');
  assert.equal(enemyTypeLabel('heavy'), '重机枪手');
  assert.equal(enemyTypeLabel('breacher'), '突击兵');
  assert.equal(enemyTypeLabel('drone'), '未知目标');
  assert.equal(enemyTypeLabel('wraith'), '未知目标');
});

test('未知敌人类型回退为未知目标', () => {
  assert.equal(enemyTypeLabel('tank'), '未知目标');
  assert.equal(enemyTypeLabel(null), '未知目标');
});

test('受伤方向转换为顺时针旋转角度', () => {
  assert.equal(damageDirectionDegrees(0), 0);
  assert.ok(Math.abs(damageDirectionDegrees(Math.PI / 2) - 90) < 1e-9);
  assert.ok(Math.abs(damageDirectionDegrees(-Math.PI / 2) + 90) < 1e-9);
  assert.ok(Math.abs(Math.abs(damageDirectionDegrees(Math.PI)) - 180) < 1e-9);
  assert.ok(Math.abs(damageDirectionDegrees((3 * Math.PI) / 2) + 90) < 1e-9);
});

test('受伤方向拒绝非法输入', () => {
  assert.throws(() => damageDirectionDegrees(Number.NaN), TypeError);
  assert.throws(() => damageDirectionDegrees('0'), TypeError);
});

test('罗盘生成三个 360° 循环、每 15° 一格', () => {
  const ticks = buildCompassTicks();
  assert.equal(ticks.length, 72);
  assert.equal(ticks[0].degree, 0);
  assert.equal(ticks[71].degree, 1065);
  assert.equal(ticks[1].degree - ticks[0].degree, 15);
});

test('罗盘在 45° 方位显示军用中文与英文标签', () => {
  const ticks = buildCompassTicks();
  const north = ticks.find((tick) => tick.degree === 0);
  const northeast = ticks.find((tick) => tick.degree === 45);
  const east = ticks.find((tick) => tick.degree === 90);
  const south = ticks.find((tick) => tick.degree === 180);
  const west = ticks.find((tick) => tick.degree === 270);

  assert.equal(north.cn, '北');
  assert.equal(north.en, 'N');
  assert.equal(northeast.cn, '东北');
  assert.equal(northeast.en, 'NE');
  assert.equal(east.cn, '东');
  assert.equal(east.en, 'E');
  assert.equal(south.cn, '南');
  assert.equal(south.en, 'S');
  assert.equal(west.cn, '西');
  assert.equal(west.en, 'W');
});

test('罗盘主要方位带度数，30° 刻度带度数，其余只显示刻度线', () => {
  const ticks = buildCompassTicks();
  const zero = ticks.find((tick) => tick.degree === 0);
  const thirty = ticks.find((tick) => tick.degree === 30);
  const fifteen = ticks.find((tick) => tick.degree === 15);

  assert.equal(zero.degreeLabel, '000');
  assert.equal(zero.major, true);
  assert.equal(thirty.degreeLabel, '030');
  assert.equal(thirty.major, false);
  assert.equal(fifteen.degreeLabel, '');
  assert.equal(fifteen.major, false);
});
