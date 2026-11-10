import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

// The subscription uses its own plain-mode connection: after subscribing Core
// sends notifications only. Requests stay on a second, ordinary connection.
export class Core extends EventEmitter {
  constructor(env = process.env) {
    super();
    this.pending = new Map();
    this.sequence = 0;
    this.stderr = '';
    this.closed = false;
    this.failure = null;
    this.child = spawn('hc', ['connect'], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      try {
        const reply = JSON.parse(line);
        if (reply.method) { this.emit('notification', reply); return; }
        const call = this.pending.get(reply.id);
        if (!call) return;
        clearTimeout(call.timer);
        this.pending.delete(reply.id);
        if (reply.error) call.reject(Object.assign(new Error(reply.error.message), { kind: reply.error.data?.kind }));
        else call.resolve(reply.result);
      } catch (error) { this.fail(error); }
    });
    this.child.stderr.on('data', bytes => { this.stderr = (this.stderr + bytes).slice(-4000); });
    this.child.on('error', error => this.fail(error));
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('exit', code => this.fail(new Error(`Core connection closed (${code}). ${this.stderr}`)));
  }

  call(method, params = {}) {
    if (this.closed || this.failure) return Promise.reject(this.failure ?? new Error('Core connection closed'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error(`${method} timed out; delivery may have happened`), { kind: 'timeout' }));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  fail(error) {
    if (this.closed || this.failure) return;
    this.failure = error;
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(error); }
    this.pending.clear();
    this.emit('disconnect', error);
  }

  close() {
    if (this.closed) return;
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(new Error('Core connection closed')); }
    this.pending.clear();
    this.closed = true;
    this.lines.close();
    this.child.stdin.end();
    this.child.kill();
  }
}
