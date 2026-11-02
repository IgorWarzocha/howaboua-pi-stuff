import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { idleShell, quote } from '../src/process.mjs';

test('restore never sends input to a non-shell or unknown process', async () => {
  assert.equal(await idleShell({ state: 'live', pid: process.pid }), false);
  assert.equal(await idleShell({ state: 'live', pid: 999999999 }), false);
  assert.equal(await idleShell({ state: 'finished', pid: process.pid }), false);
});
test('shell quoting preserves apostrophes and rejects injected control keys', async () => {
  const text = "a'b;$(touch /never-run-this)";
  const output = await new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', `printf %s ${quote(text)}`]);
    let value = '';
    child.stdout.on('data', chunk => { value += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(value) : reject(new Error('shell failed')));
  });
  assert.equal(output, text);
  assert.throws(() => quote('hi\nrm -rf /'), /Unsafe/);
});
