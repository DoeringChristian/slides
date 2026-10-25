import { test, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { bounded, ownedResources, stopOwnedChild } from './browser-owned-resources.mjs';

test('bounded operations reject stalled work and return completed values', async () => {
  await expect(bounded(new Promise(() => {}), 20, 'stalled setup')).rejects.toThrow('stalled setup timed out');
  await expect(bounded(Promise.resolve(7), 1000, 'completed')).resolves.toBe(7);
});

test('all allocated resources close even when another destructor rejects', async () => {
  const owned = ownedResources(), closed = [];
  owned.add('first', () => { closed.push('first'); });
  owned.add('failed destructor', () => { throw Error('injected teardown error'); }, () => closed.push('forced'));
  owned.add('last', () => { closed.push('last'); });
  await expect(owned.close()).rejects.toThrow('Owned cleanup failed');
  expect(closed.sort()).toEqual(['first', 'forced', 'last']);
});

test('late setup allocations are destroyed rather than escaping a closed scope', async () => {
  const owned = ownedResources(); await owned.close(); let forced = false, disposed = false;
  expect(() => owned.add('late', () => { disposed = true; }, () => { forced = true; })).toThrow('Late owned allocation');
  await Promise.resolve(); expect(forced).toBe(true); expect(disposed).toBe(true);
});

test('owned child ignoring SIGTERM is killed and reaped within the teardown bound', async () => {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    await bounded(new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); }), 1000, 'owned child readiness');
    await stopOwnedChild(child); expect(child.signalCode).toBe('SIGKILL');
  } finally { child.kill('SIGKILL'); }
});
