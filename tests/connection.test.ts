import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Socket } from 'socket.io-client';
import { connectForRoom } from '../src/lib/online';

class TestConnection extends EventEmitter {
  attempts = 0;
  disconnected = 0;
  connect() { this.attempts++; return this; }
  disconnect() { this.disconnected++; return this; }
  asClient() { return this as unknown as Pick<Socket, 'connect' | 'disconnect' | 'on' | 'off'>; }
}

test('initial room connection retries cold-start failures and cleans up after success', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new TestConnection();
  const operation = connectForRoom(client.asClient(), new AbortController().signal);
  assert.equal(client.attempts, 1);
  for (let attempt = 0; attempt < 4; attempt++) {
    client.emit('connect_error', new Error('Starting'));
    context.mock.timers.tick(2000);
  }
  assert.equal(client.attempts, 5);
  client.emit('connect');
  await operation;
  assert.equal(client.listenerCount('connect_error'), 0);
  assert.equal(client.listenerCount('connect'), 0);
  client.emit('disconnect');
  client.emit('connect_error');
  context.mock.timers.tick(100_000);
  assert.equal(client.attempts, 5);
  assert.equal(client.disconnected, 0);
});

test('an unresponsive connection ends within the 90-second budget', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new TestConnection();
  const operation = connectForRoom(client.asClient(), new AbortController().signal);
  const rejection = assert.rejects(operation, /90 seconds/);
  context.mock.timers.tick(90_000);
  await rejection;
  assert.equal(client.disconnected, 1);
  assert.equal(client.listenerCount('connect_error'), 0);
  context.mock.timers.tick(100_000);
  assert.equal(client.attempts, 1);
});

test('canceling a cold-start retry stops future attempts and releases listeners', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new TestConnection();
  const controller = new AbortController();
  const operation = connectForRoom(client.asClient(), controller.signal);
  const rejection = assert.rejects(operation, /canceled/);
  client.emit('connect_error');
  controller.abort();
  await rejection;
  context.mock.timers.tick(100_000);
  assert.equal(client.attempts, 1);
  assert.equal(client.disconnected, 1);
  assert.equal(client.eventNames().length, 0);
});

test('an already canceled room request never opens a connection', async () => {
  const client = new TestConnection();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(connectForRoom(client.asClient(), controller.signal), /canceled/);
  assert.equal(client.attempts, 0);
});

test('a successful connection leaves existing game listeners intact', async () => {
  const client = new TestConnection();
  let gameEvent = false;
  client.on('connect', () => { gameEvent = true; });
  const operation = connectForRoom(client.asClient(), new AbortController().signal);
  client.emit('connect');
  await operation;
  assert.equal(gameEvent, true);
  assert.equal(client.listenerCount('connect'), 1);
});