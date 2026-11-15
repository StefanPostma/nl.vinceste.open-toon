'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createClock, settle } = require('../helpers/fake-clock');

describe('NFR-06 AC1: fake clock', () => {
  test('time moves only through tick and timers fire in due order', async () => {
    const clock = createClock(1000);
    const fired = [];
    clock.setTimeout(() => fired.push('b'), 200);
    clock.setTimeout(() => fired.push('a'), 100);
    clock.setTimeout(() => fired.push('c'), 200);

    assert.equal(clock.now(), 1000);
    await clock.tick(99);
    assert.deepEqual(fired, []);
    await clock.tick(1);
    assert.deepEqual(fired, ['a']);
    await clock.tick(500);
    assert.deepEqual(fired, ['a', 'b', 'c'], 'equal due times fire in the order they were armed');
    assert.equal(clock.now(), 1600);
  });

  test('a timer armed by a timer inside the tick window fires in the same tick', async () => {
    const clock = createClock();
    const fired = [];
    clock.setTimeout(() => {
      fired.push(clock.now());
      clock.setTimeout(() => fired.push(clock.now()), 50);
    }, 100);

    await clock.tick(200);
    assert.deepEqual(fired, [100, 150]);
  });

  test('armed() counts scheduled timers and clearTimeout disarms them', async () => {
    const clock = createClock();
    const handle = clock.setTimeout(() => assert.fail('cleared timer fired'), 10);
    clock.setTimeout(() => {}, 20);
    assert.equal(clock.armed(), 2);

    clock.clearTimeout(handle);
    assert.equal(clock.armed(), 1);
    await clock.tick(100);
    assert.equal(clock.armed(), 0);
  });

  test('setInterval repeats until cleared', async () => {
    const clock = createClock();
    let count = 0;
    const handle = clock.setInterval(() => {
      count++;
    }, 30);

    await clock.tick(100);
    assert.equal(count, 3);
    clock.clearInterval(handle);
    await clock.tick(100);
    assert.equal(count, 3);
    assert.equal(clock.armed(), 0);
  });

  test('promise continuations settle before the next timer fires', async () => {
    const clock = createClock();
    const order = [];
    clock.setTimeout(() => {
      Promise.resolve().then(() => Promise.resolve()).then(() => order.push('continuation'), assert.ifError);
    }, 10);
    clock.setTimeout(() => order.push('second timer'), 20);

    await clock.tick(30);
    assert.deepEqual(order, ['continuation', 'second timer']);
  });

  test('runAll drains one-shot timers and refuses an endless interval', async () => {
    const clock = createClock();
    let count = 0;
    clock.setTimeout(() => {
      count++;
      clock.setTimeout(() => {
        count++;
      }, 1000);
    }, 500);
    await clock.runAll();
    assert.equal(count, 2);
    assert.equal(clock.now(), 1500);

    clock.setInterval(() => {}, 10);
    await assert.rejects(() => clock.runAll(200), /did not settle/);
  });
});

describe('NFR-06 AC1: settle() lets the clock run until a promise has settled', () => {
  const later = (clock, ms, outcome) => new Promise((resolve, reject) => {
    clock.setTimeout(() => (outcome === 'fail' ? reject(new Error('late failure')) : resolve('late value')), ms);
  });

  test('it resolves with the value and the fake time that passed', async () => {
    const clock = createClock();

    assert.deepEqual(await settle(clock, later(clock, 1234)), { value: 'late value', tookMs: 1300 });
  });

  test('a promise that is settled already costs no fake time', async () => {
    const clock = createClock();

    assert.deepEqual(await settle(clock, Promise.resolve('now')), { value: 'now', tookMs: 0 });
    assert.equal((await settle(clock, Promise.reject(new Error('now')))).tookMs, 0);
  });

  test('a rejection is reported as an error, not thrown', async () => {
    const clock = createClock();
    const { error, value, tookMs } = await settle(clock, later(clock, 250, 'fail'), { stepMs: 50 });

    assert.equal(error.message, 'late failure');
    assert.equal(value, undefined);
    assert.equal(tookMs, 250);
  });

  test('a promise that never settles within the limit is an error of the test, not a hang', async () => {
    const clock = createClock();

    await assert.rejects(settle(clock, new Promise(() => {}), { limitMs: 1000 }), /did not settle within 1000 ms/);
  });
});
