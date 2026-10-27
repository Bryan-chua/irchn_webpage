import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = process.cwd();

// Execute the real routes and component, replacing only their platform adapters.
function moduleLoader(overrides, globals = {}) {
  const cache = new Map();
  function load(name, parent = root) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    const resolved = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(parent, name);
    const filename = /\.tsx?$/.test(resolved) ? resolved : `${resolved}.ts`;
    if (cache.has(filename)) return cache.get(filename).exports;
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule);
    const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const context = vm.createContext({ console, Request, Response, Headers, URL, crypto, Date, TextEncoder, ...globals });
    const execute = vm.runInContext(`(function(require,module,exports){${source}\n})`, context, { filename });
    execute(child => load(child, path.dirname(filename)), loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return load;
}

function databaseAdapter(sqlite) {
  return {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...args) { values = args; return statement; },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async run() {
          const result = sqlite.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = []; for (const s of statements) results.push(await s.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}

test('station, public tickets, join retries and emergency CSV share insertion order despite reversed timestamps', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(path.join('drizzle', file), 'utf8'));
    const db = databaseAdapter(sqlite);
    const load = moduleLoader({
      'cloudflare:workers': { env: { DB: db, JOIN_RATE_LIMITER: { limit: async () => ({ success: true }) } } },
      '@/lib/moderator-auth': { moderatorHouse: async () => 'RV', isOverallModerator: async () => true },
      '@/lib/operations': { recordStationPresence: async () => {}, recordActivity: async () => {}, recordSiteError: async () => {}, raiseAlert: async () => {} },
    });
    const station = load('@/app/api/moderator/queue/route');
    const ticketRoute = load('@/app/api/queues/[queueNumber]/route');
    const joinRoute = load('@/app/api/queues/route');
    const exportRoute = load('@/app/api/moderator/overall/emergency-export/route');
    const insert = sqlite.prepare(`INSERT INTO queue_entries (queue_number,join_key,device_token_hash,house_code,nickname,group_size,status,joined_at) VALUES (?,?,?,'RV',?,2,?,?)`);
    const seeds = [];
    const now = Date.now();
    for (let i = 0; i < 120; i++) {
      const deviceToken = crypto.randomUUID();
      const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(deviceToken))).toString('hex');
      const entry = { queueNumber: `RV-${String(i).padStart(4, '0')}`, joinKey: crypto.randomUUID(), deviceToken };
      entry.id = Number(insert.run(entry.queueNumber, entry.joinKey, hash, `team-${i}`, i % 13 === 0 ? 'skipped' : 'waiting', now - (i % 17) * 1000).lastInsertRowid);
      seeds.push(entry);
    }
    sqlite.exec(`INSERT INTO queue_entries (queue_number,house_code,nickname,group_size,status,joined_at) VALUES ('CP-9999','CP','other house',2,'waiting',1)`);
    const readTicket = async number => (await (await ticketRoute.GET(new Request('https://test/api/queues/' + number), { params: Promise.resolve({ queueNumber: number }) })).json()).ticket;
    const queue = async () => (await (await station.GET(new Request('https://test/api/moderator/queue'))).json()).active;
    const assertPositions = async () => {
      const active = await queue();
      const waiting = active.filter(e => e.status === 'waiting');
      assert.deepEqual(waiting.map(e => e.id), waiting.map(e => e.id).toSorted((a, b) => a - b));
      for (const [position, entry] of waiting.entries()) assert.equal((await readTicket(entry.queueNumber)).groupsAhead, position, entry.queueNumber);
      const csv = await (await exportRoute.GET(new Request('https://test/export'))).text();
      assert.deepEqual(csv.split('\r\n').slice(1).filter(row => row.startsWith('RVRC,')).map(row => row.split(',')[2]), active.map(e => e.queueNumber));
    };
    await assertPositions();
    const target = seeds[21];
    for (const status of ['entered', 'waiting', 'skipped', 'waiting']) {
      const response = await station.PATCH(new Request('https://test/api/moderator/queue', { method: 'PATCH', body: JSON.stringify({ ids: [target.id], status }) }));
      assert.equal(response.status, 200);
      await assertPositions();
    }
    for (const joinKey of [target.joinKey, crypto.randomUUID()]) {
      const response = await joinRoute.POST(new Request('https://test/api/queues', { method: 'POST', body: JSON.stringify({ houseCode: 'RV', nickname: 'retry', groupSize: 2, joinKey, deviceToken: target.deviceToken }) }));
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.ticket.queueNumber, target.queueNumber);
      assert.equal(result.ticket.groupsAhead, (await readTicket(target.queueNumber)).groupsAhead);
    }
    const created = await joinRoute.POST(new Request('https://test/api/queues', { method: 'POST', body: JSON.stringify({ houseCode: 'RV', nickname: 'new ticket', groupSize: 2, joinKey: crypto.randomUUID(), deviceToken: crypto.randomUUID() }) }));
    assert.equal(created.status, 201);
    const newTicket = (await created.json()).ticket;
    assert.equal(newTicket.groupsAhead, (await queue()).filter(e => e.status === 'waiting').length - 1);
    await assertPositions();
  } finally { sqlite.close(); }
});

function ticketHarness() {
  const state = [], effects = [], timers = new Map(), windowListeners = new Map(), documentListeners = new Map();
  let stateIndex = 0, timerId = 0, fetchCount = 0;
  let serverTicket = { queueNumber: 'RV-1234', houseCode: 'RV', groupSize: 2, status: 'entered', groupsAhead: 0, estimatedSeconds: 0 };
  let pendingFetch;
  const document = { hidden: false, addEventListener: (type, fn) => documentListeners.set(type, fn), removeEventListener: type => documentListeners.delete(type) };
  const load = moduleLoader({
    react: {
      useState(initial) { const index = stateIndex++; state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
      useEffect: fn => effects.push(fn), useRef: value => ({ current: value }),
    },
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
    'next/navigation': { useSearchParams: () => ({ get: () => null }) },
  }, {
    document, navigator: { onLine: true },
    window: { addEventListener: (type, fn) => windowListeners.set(type, fn), removeEventListener: type => windowListeners.delete(type) },
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async () => { fetchCount++; if (pendingFetch) await pendingFetch; return { ok: true, json: async () => ({ ticket: { ...serverTicket } }) }; },
  });
  load('@/components/QueueStatusClient.tsx').default({ queueNumber: 'RV-1234' });
  const cleanup = effects[0]();
  return { state, timers, document, windowListeners, documentListeners, cleanup, count: () => fetchCount,
    change: status => { serverTicket = { ...serverTicket, status, estimatedSeconds: status === 'waiting' ? 240 : 0 }; },
    hold: promise => { pendingFetch = promise; },
    async poll() { const item = [...timers].find(([, t]) => t.delay > 0); assert.ok(item, 'a future ticket refresh must remain scheduled'); timers.delete(item[0]); await item[1].fn(); },
  };
}

test('an entered ticket polls again and detects Undo without a page reload', async () => {
  const h = ticketHarness();
  await setImmediate();
  assert.equal(h.state[0].status, 'entered');
  h.change('waiting');
  await h.poll();
  assert.equal(h.state[0].status, 'waiting');
  assert.equal(h.state[0].estimatedSeconds, 240);
  h.change('skipped'); await h.poll(); assert.equal(h.state[0].status, 'skipped');
  h.change('waiting'); await h.poll(); assert.equal(h.state[0].status, 'waiting');
  h.cleanup();
  assert.equal(h.timers.size, 0);
});

test('returning to the ticket tab refreshes immediately, without overlapping polls or refreshes after unmount', async () => {
  const h = ticketHarness();
  await setImmediate();
  h.document.hidden = true;
  h.documentListeners.get('visibilitychange')();
  assert.equal([...h.timers.values()].filter(t => t.delay > 0).length, 0);
  const hiddenCount = h.count();
  h.windowListeners.get('focus')();
  await setImmediate();
  assert.equal(h.count(), hiddenCount);
  h.change('waiting');
  h.document.hidden = false;
  let release;
  h.hold(new Promise(resolve => { release = resolve; }));
  h.documentListeners.get('visibilitychange')();
  h.windowListeners.get('focus')();
  h.windowListeners.get('online')();
  assert.equal(h.count(), hiddenCount + 1);
  release(); await setImmediate();
  assert.equal(h.state[0].status, 'waiting');
  assert.equal([...h.timers.values()].filter(t => t.delay > 0).length, 1);
  h.cleanup();
  assert.equal(h.windowListeners.size, 0);
  assert.equal(h.documentListeners.size, 0);
  assert.equal(h.timers.size, 0);
});
