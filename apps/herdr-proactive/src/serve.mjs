import { Core } from './core.mjs';
import { State, acquireLock } from './state.mjs';
import { Engine } from './engine.mjs';
import { Catalog } from './catalog.mjs';

export async function serve(env = process.env) {
  const core = new Core(env);
  const subscription = new Core(env);
  let state;
  let release;
  let engine;
  let failure;
  let ready = false;
  const buffered = [];
  let finish;
  const stopped = new Promise(resolve => { finish = resolve; });
  const stop = error => { failure ??= error; finish(); };
  const signal = () => stop();
  core.on('disconnect', stop);
  subscription.on('disconnect', stop);
  process.once('SIGTERM', signal);
  process.once('SIGINT', signal);
  try {
    const hello = await core.call('hello', { generation: 1 });
    for (const method of ['events.subscribe', 'doc.get', 'terminal.send']) {
      if (!hello.methods.includes(method)) throw new Error(`Core does not support ${method}. Update Core before starting proactivity.`);
    }
    release = await acquireLock(hello.core.id, env);
    state = new State(hello.core.id, env);
    await state.load();
    state.value.service = { pid: process.pid, coreId: hello.core.id, startedAt: Date.now(), observedAt: Date.now(), error: null };
    const catalog = new Catalog(core, hello.core.id, env, space => engine.filesChanged(space));
    engine = new Engine(core, state, catalog, stop);
    subscription.on('notification', message => {
      if (!ready) {
        buffered.push(message);
        if (buffered.length > 2048) stop(new Error('Startup event backlog exceeded its limit'));
      } else engine.enqueue(() => engine.notification(message));
    });
    const snapshot = await subscription.call('events.subscribe');
    engine.snapshot(snapshot);
    engine.enqueue(async () => {
      await catalog.discover([...engine.terminals.values()]);
      await engine.configure();
      await state.save();
      ready = true;
      for (const message of buffered) engine.enqueue(() => engine.notification(message));
      buffered.length = 0;
    });
    await engine.chain;
    if (failure) throw failure;
    console.log(JSON.stringify({ running: true, core: hello.core.name, pid: process.pid }));
    await stopped;
    if (failure) throw failure;
  } finally {
    process.removeListener('SIGTERM', signal);
    process.removeListener('SIGINT', signal);
    if (engine) {
      try {
        await engine.close();
        state.value.service.pid = null;
        state.value.service.error = failure?.message ?? null;
        await state.save();
      } catch (error) { console.error(`Could not persist shutdown: ${error.message}`); }
    }
    subscription.close();
    core.close();
    try { state?.close(); }
    finally { if (release) await release(); }
  }
}
