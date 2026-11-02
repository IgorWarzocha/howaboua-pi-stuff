import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class Core {
  constructor(env = process.env) {
    this.child = spawn(env.HERDR_STATE_HC || 'hc', ['connect'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.pending = new Map();
    this.sequence = 0;
    this.stderr = '';
    this.child.stderr.on('data', data => { this.stderr = (this.stderr + data).slice(-4000); });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let reply;
      try { reply = JSON.parse(line); } catch { return this.fail(new Error('Core returned invalid JSON')); }
      const call = this.pending.get(reply.id);
      if (!call) return;
      this.pending.delete(reply.id);
      clearTimeout(call.timer);
      if (reply.error) {
        const error = new Error(reply.error.message);
        error.kind = reply.error.data?.kind;
        call.reject(error);
      }
      else call.resolve(reply.result);
    });
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', code => this.fail(new Error(`Core connection closed (${code}): ${this.stderr}`)));
    this.child.stdin.on('error', error => this.fail(error));
  }

  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out; inspect Core before retrying`));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  fail(error) {
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(error); }
    this.pending.clear();
  }

  close() { this.lines.close(); this.child.stdin.end(); this.child.kill(); }
}
