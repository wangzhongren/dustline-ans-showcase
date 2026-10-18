import assert from 'node:assert/strict';
import test from 'node:test';

import { createEventBus } from '../../src/common/shared/event-bus.js';

test('订阅后收到载荷，退订后不再收到', () => {
  const bus = createEventBus();
  const received = [];
  const unsubscribe = bus.on('hud:update', (payload) => {
    received.push(payload);
  });

  bus.emit('hud:update', { score: 100 });
  unsubscribe();
  bus.emit('hud:update', { score: 200 });

  assert.deepEqual(received, [{ score: 100 }]);
  assert.equal(bus.listenerCount('hud:update'), 0);
});

test('重复订阅同一处理函数会独立触发，退订一次只移除一条', () => {
  const bus = createEventBus();
  let calls = 0;
  const handler = () => {
    calls += 1;
  };

  const first = bus.on('hud:hitmarker', handler);
  bus.on('hud:hitmarker', handler);
  assert.equal(bus.listenerCount('hud:hitmarker'), 2);

  bus.emit('hud:hitmarker', { killed: false });
  assert.equal(calls, 2);

  first();
  assert.equal(bus.listenerCount('hud:hitmarker'), 1);
  bus.emit('hud:hitmarker', { killed: false });
  assert.equal(calls, 3);
});

test('once 只触发一次，且在处理器抛错时也会先退订', () => {
  const bus = createEventBus({
    onError: () => {
      // 测试中吞掉预期错误，避免控制台噪音。
    },
  });
  let calls = 0;

  bus.once('game:state', () => {
    calls += 1;
    throw new Error('boom');
  });
  bus.emit('game:state', { state: 'playing' });
  bus.emit('game:state', { state: 'paused' });

  assert.equal(calls, 1);
  assert.equal(bus.listenerCount('game:state'), 0);
});

test('一个处理器抛错不影响其余处理器，并在 onError 中报告', () => {
  const reported = [];
  const bus = createEventBus({
    onError: (error, eventName, payload) => {
      reported.push({ error, eventName, payload });
    },
  });
  const order = [];

  bus.on('hud:damage', () => {
    order.push('first');
    throw new Error('handler failed');
  });
  bus.on('hud:damage', () => {
    order.push('second');
  });

  const invoked = bus.emit('hud:damage', { amount: 12 });

  assert.equal(invoked, 2);
  assert.deepEqual(order, ['first', 'second']);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].eventName, 'hud:damage');
  assert.equal(reported[0].payload.amount, 12);
  assert.equal(reported[0].error.message, 'handler failed');
});

test('未配置 onError 时错误输出到控制台但不中断派发', () => {
  const bus = createEventBus();
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => {
    logs.push(args);
  };
  let reached = false;

  try {
    bus.on('world:impact', () => {
      throw new Error('intentional');
    });
    bus.on('world:impact', () => {
      reached = true;
    });
    bus.emit('world:impact', { position: { x: 1, y: 2, z: 3 } });
  } finally {
    console.error = originalError;
  }

  assert.equal(reached, true);
  assert.equal(logs.length, 1);
});

test('派发期间的退订与新增不会破坏当次快照，新增处理器下一次生效', () => {
  const bus = createEventBus();
  const order = [];
  const lateHandler = () => {
    order.push('late');
  };

  const unsubscribeFirst = bus.on('hud:killfeed', () => {
    order.push('first');
    unsubscribeFirst();
    bus.on('hud:killfeed', lateHandler);
  });
  bus.on('hud:killfeed', () => {
    order.push('second');
  });

  bus.emit('hud:killfeed', { enemyType: 'drone', score: 100 });
  assert.deepEqual(order, ['first', 'second']);

  bus.emit('hud:killfeed', { enemyType: 'drone', score: 100 });
  assert.deepEqual(order, ['first', 'second', 'second', 'late']);
});

test('off 返回是否移除登记，clear 可清空单个或全部事件', () => {
  const bus = createEventBus();
  const handler = () => {};

  bus.on('a', handler);
  bus.on('b', handler);

  assert.equal(bus.off('a', handler), true);
  assert.equal(bus.off('a', handler), false);

  bus.clear('b');
  assert.equal(bus.listenerCount('b'), 0);

  bus.on('c', handler);
  bus.on('d', handler);
  bus.clear();
  assert.equal(bus.listenerCount('c'), 0);
  assert.equal(bus.listenerCount('d'), 0);
});

test('非法订阅参数立即抛错', () => {
  const bus = createEventBus();
  assert.throws(() => bus.on('', () => {}), TypeError);
  assert.throws(() => bus.on('x', null), TypeError);
  assert.throws(() => bus.once('x', 'not-a-function'), TypeError);
});

test('没有订阅者时 emit 返回 0，不抛错', () => {
  const bus = createEventBus();
  assert.equal(bus.emit('world:explosion', { position: null }), 0);
});
