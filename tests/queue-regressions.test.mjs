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
      sqlite.prepare('INSERT INTO participant_devices (device_token_hash, home_rc) VALUES (?, ?)').run(hash, 'RV');
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
    const newDevice = crypto.randomUUID();
    const newHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(newDevice))).toString('hex');
    sqlite.prepare('INSERT INTO participant_devices (device_token_hash, home_rc) VALUES (?, ?)').run(newHash, 'RV');
    const created = await joinRoute.POST(new Request('https://test/api/queues', { method: 'POST', body: JSON.stringify({ houseCode: 'RV', nickname: 'new ticket', groupSize: 2, joinKey: crypto.randomUUID(), deviceToken: newDevice }) }));
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

test('home RC is remembered on the server, links legacy tickets and cannot be overwritten', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(path.join('drizzle', file), 'utf8'));
    const db = databaseAdapter(sqlite);
    const load = moduleLoader({ 'cloudflare:workers': { env: { DB: db } } });
    const participant = load('@/app/api/participant/route');
    const deviceToken = crypto.randomUUID();
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(deviceToken))).toString('hex');
    sqlite.prepare(`INSERT INTO queue_entries (queue_number,device_token_hash,house_code,nickname,group_size,joined_at) VALUES ('RV-0001',?,'RV','legacy',2,?)`).run(hash, Date.now());
    const profile = async body => participant.POST(new Request('https://test/api/participant', { method: 'POST', body: JSON.stringify({ deviceToken, ...body }) }));
    assert.equal((await (await profile({})).json()).homeRc, null);
    assert.equal((await (await profile({ homeRc: 'RV' })).json()).homeRc, 'RV');
    assert.equal(sqlite.prepare('SELECT home_rc FROM queue_entries').get().home_rc, 'RV');
    assert.equal((await (await profile({ homeRc: 'CP' })).json()).homeRc, 'RV');
    assert.equal((await (await profile({})).json()).homeRc, 'RV');
    assert.equal((await profile({ homeRc: 'invalid' })).status, 400);
  } finally { sqlite.close(); }
});

test('dashboard cutoff cancels outside/unknown RC tickets, blocks joins and undo, and preserves own-RC tickets', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(path.join('drizzle', file), 'utf8'));
    const db = databaseAdapter(sqlite);
    const load = moduleLoader({
      'cloudflare:workers': { env: { DB: db, JOIN_RATE_LIMITER: { limit: async () => ({ success: true }) } } },
      '@/lib/moderator-auth': { moderatorHouse: async () => 'RV', isOverallModerator: async () => true },
      '@/lib/operations': { recordStationPresence: async () => {}, recordActivity: async () => {}, recordSiteError: async () => {}, raiseAlert: async () => {}, resolveAlert: async () => {} },
    });
    const overall = load('@/app/api/moderator/overall/route');
    const participant = load('@/app/api/participant/route');
    const join = load('@/app/api/queues/route');
    const station = load('@/app/api/moderator/queue/route');
    const ticket = load('@/app/api/queues/[queueNumber]/route');
    const exportRoute = load('@/app/api/moderator/overall/emergency-export/route');
    const deviceToken = crypto.randomUUID();
    assert.equal((await participant.POST(new Request('https://test/api/participant', { method: 'POST', body: JSON.stringify({ deviceToken, homeRc: 'RV' }) }))).status, 200);
    const joinHouse = (houseCode, token = deviceToken) => join.POST(new Request('https://test/api/queues', { method: 'POST', body: JSON.stringify({ deviceToken: token, houseCode, nickname: 'test group', groupSize: 4, joinKey: crypto.randomUUID() }) }));
    const patch = body => overall.PATCH(new Request('https://test/api/moderator/overall', { method: 'PATCH', body: JSON.stringify(body) }));
    assert.equal((await patch({ homeRcOnlyAt: 'invalid' })).status, 400);
    assert.equal((await patch({ homeRcOnlyAt: Date.now() + 3600000 })).status, 200);
    const own = (await (await joinHouse('RV')).json()).ticket;
    const outside = (await (await joinHouse('CP')).json()).ticket;
    const outsideWaiting = (await (await joinHouse('TM')).json()).ticket;
    sqlite.exec(`UPDATE queue_entries SET status = 'skipped' WHERE house_code = 'CP'`);
    sqlite.exec(`INSERT INTO queue_entries (queue_number,house_code,nickname,group_size,status,joined_at) VALUES ('RV-9999','RV','unknown RC',2,'waiting',1),('RV-9998','RV','finished',2,'entered',1)`);
    const cutoff = Date.now() - 1000;
    assert.equal((await patch({ homeRcOnlyAt: cutoff })).status, 200);
    const read = async number => (await (await ticket.GET(new Request('https://test/ticket'), { params: Promise.resolve({ queueNumber: number }) })).json()).ticket;
    assert.equal((await read(own.queueNumber)).status, 'waiting');
    assert.equal((await read(own.queueNumber)).groupsAhead, 0);
    assert.equal((await read(outside.queueNumber)).status, 'cancelled');
    assert.equal((await read(outsideWaiting.queueNumber)).status, 'cancelled');
    assert.equal((await read(outside.queueNumber)).cancellationReason, 'rc_cutoff');
    assert.equal((await read('RV-9999')).status, 'cancelled');
    assert.equal((await read('RV-9998')).status, 'entered');
    assert.equal((await joinHouse('CP')).status, 403);
    assert.equal((await joinHouse('RV')).status, 200); // existing own ticket
    sqlite.prepare("UPDATE queue_entries SET status = 'entered' WHERE queue_number = ?").run(own.queueNumber);
    const newOwnResponse = await joinHouse('RV');
    assert.equal(newOwnResponse.status, 201); // a fresh own-RC ticket after cutoff
    const newOwn = (await newOwnResponse.json()).ticket;
    assert.equal((await joinHouse('RV', crypto.randomUUID())).status, 400); // no selected RC
    const active = (await (await station.GET(new Request('https://test/station'))).json()).active;
    assert.deepEqual(active.map(e => e.queueNumber), [newOwn.queueNumber]);
    const csv = await (await exportRoute.GET(new Request('https://test/export'))).text();
    assert.ok(!csv.includes(outside.queueNumber));
    assert.ok(!csv.includes('RV-9999'));
    const ended = sqlite.prepare("SELECT id FROM queue_entries WHERE queue_number = 'RV-9998'").get();
    assert.equal((await station.PATCH(new Request('https://test/station', { method: 'PATCH', body: JSON.stringify({ ids: [ended.id], status: 'waiting' }) }))).status, 409);
    // Database guards also reject writes that race with the cutoff, bypassing route checks.
    assert.throws(() => sqlite.exec(`INSERT INTO queue_entries (queue_number,home_rc,house_code,nickname,group_size,joined_at) VALUES ('CP-7777','RV','CP','race',2,1)`), /rc_cutoff/);
    assert.throws(() => sqlite.exec(`UPDATE queue_entries SET status = 'waiting' WHERE queue_number = '${outside.queueNumber}'`), /rc_cutoff/);
    assert.equal((await patch({ homeRcOnlyAt: null })).status, 200);
    assert.equal((await read(outside.queueNumber)).status, 'cancelled');
    assert.equal((await joinHouse('CP')).status, 201);
    // An unattended cutoff is enforced on the next queue read without a dashboard open.
    sqlite.prepare('UPDATE event_settings SET home_rc_only_at = ? WHERE id = 1').run(cutoff);
    assert.equal((await read(sqlite.prepare("SELECT queue_number FROM queue_entries WHERE house_code = 'CP' AND status = 'waiting'").get().queue_number)).status, 'cancelled');
  } finally { sqlite.close(); }
});

function bulkActionHarness(failSecondBatch = false, skippedCount = 0) {
  const entries = Array.from({ length: 237 }, (_, i) => ({ id: i + 1, queueNumber: `RV-${String(i).padStart(4, '0')}`, nickname: 'test', groupSize: 2, status: i < skippedCount ? 'skipped' : 'waiting', joinedAt: Date.now() }));
  const queueData = { houseCode: 'RV', status: 'open', lastEnteredAt: null, eventStatus: 'open', stationControlsLocked: false, active: entries, history: [] };
  const state = [queueData, [], 'active', '', Date.now(), Date.now(), false];
  let stateIndex = 0;
  const batches = [];
  const jsx = (type, props) => ({ type, props });
  const load = moduleLoader({
    react: {
      useState(initial) { const index = stateIndex++; if (index >= state.length) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
      useCallback: fn => fn, useMemo: fn => fn(), useEffect: () => {},
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/InfoDrawer': { __esModule: true, default: () => null },
    '@/docs/stationmaster.md?raw': '',
  }, {
    window: { localStorage: { setItem() {} } },
    fetch: async (_path, options) => {
      if (options?.method === 'PATCH') {
        const body = JSON.parse(options.body); batches.push(body);
        if (failSecondBatch && batches.length === 2) return { ok: false, json: async () => ({ error: 'Test batch failure' }) };
        return { ok: true };
      }
      return { ok: true, status: 200, json: async () => queueData };
    },
  });
  const Component = load('@/components/ModeratorDashboard.tsx').default;
  const render = () => { stateIndex = 0; return Component({ expectedHouse: 'RV' }); };
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const match = find(child, predicate); if (match) return match; }
    return null;
  }
  return { state, batches, async run(action = 'entered') {
    find(render(), node => node.type === 'input' && node.props.type === 'checkbox' && !node.props['aria-label']).props.onChange({ target: { checked: true } });
    assert.equal(state[1].length, 237);
    await find(render(), node => node.type === 'button' && (action === 'entered' ? node.props.className === 'enter-button' : node.props.children === 'Skip')).props.onClick();
  } };
}

test('Select all processes every group in batches of at most 100', async () => {
  const h = bulkActionHarness(); await h.run();
  assert.deepEqual(h.batches.map(b => b.ids.length), [100, 100, 37]);
  assert.deepEqual(h.batches.flatMap(b => b.ids), Array.from({ length: 237 }, (_, i) => i + 1));
  assert.ok(h.batches.every(b => b.status === 'entered'));
  assert.equal(h.state[1].length, 0);
});

test('a failed later bulk batch retains the unprocessed selection and stops', async () => {
  const h = bulkActionHarness(true); await h.run();
  assert.deepEqual(h.batches.map(b => b.ids.length), [100, 100]);
  assert.deepEqual(Array.from(h.state[1]), Array.from({ length: 137 }, (_, i) => i + 101));
  assert.equal(h.state[3], 'Test batch failure');
});


test('Skip all ignores already-skipped groups before splitting into batches', async () => {
  const h = bulkActionHarness(false, 100); await h.run('skipped');
  assert.deepEqual(h.batches.map(b => b.ids.length), [100, 37]);
  assert.deepEqual(h.batches.flatMap(b => b.ids), Array.from({ length: 137 }, (_, i) => i + 101));
  assert.ok(h.batches.every(b => b.status === 'skipped'));
});

function stationOfflineHarness(snapshotAge = 1000) {
  const snapshot = { houseCode: 'RV', status: 'open', lastEnteredAt: null, eventStatus: 'open', stationControlsLocked: false,
    active: [{ id: 1, queueNumber: 'RV-1111', nickname: 'snapshot group', groupSize: 2, status: 'waiting', joinedAt: Date.now() }], savedAt: Date.now() - snapshotAge };
  const state = [], effects = [], timers = [], listeners = new Map();
  const storage = new Map([['irchn:station-queue-snapshot:RV', JSON.stringify(snapshot)]]);
  let index = 0, online = false;
  const jsx = (type, props) => ({ type, props });
  const load = moduleLoader({
    react: {
      useState(initial) { const i = index++; if (i >= state.length) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
      useCallback: fn => fn, useMemo: fn => fn(), useEffect: fn => effects.push(fn),
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/InfoDrawer': { __esModule: true, default: () => null },
    '@/docs/stationmaster.md?raw': '',
  }, {
    window: { localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
      addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
    fetch: async () => { if (!online) throw new Error('Simulated lost connection'); return { ok: true, status: 200, json: async () => ({ ...snapshot, active: [], history: [] }) }; },
  });
  const component = load('@/components/ModeratorDashboard.tsx').default;
  const render = () => { index = 0; return component({ expectedHouse: 'RV' }); };
  function nodes(node, predicate) {
    if (!node || typeof node !== 'object') return [];
    return [...(predicate(node) ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => nodes(child, predicate))];
  }
  render(); const cleanup = effects[0]();
  return { state, storage, render, nodes, cleanup, async fail() { await timers[0](); }, async reconnect() { online = true; listeners.get('online')(); await setImmediate(); } };
}

test('station falls back to a read-only snapshot and recovers on reconnect', async () => {
  const h = stationOfflineHarness(); await h.fail();
  assert.equal(h.state[6], true); assert.equal(h.state[0].active[0].queueNumber, 'RV-1111');
  const tree = h.render();
  assert.equal(h.nodes(tree, n => n.props?.className === 'offline-backup-notice').length, 1);
  const controls = h.nodes(tree, n => n.type === 'button' && ['open', 'paused', 'closed'].includes(n.props.children));
  assert.ok(controls.every(n => n.props.disabled));
  assert.ok(h.nodes(tree, n => n.type === 'button' && n.props.className === 'enter-button')[0].props.disabled);
  await h.reconnect(); assert.equal(h.state[6], false); assert.equal(h.state[0].active.length, 0);
  h.cleanup();
});

test('station rejects emergency snapshots older than 24 hours', async () => {
  const h = stationOfflineHarness(25 * 3600000); await h.fail();
  assert.equal(h.state[0], null); assert.equal(h.state[6], true);
  assert.match(h.state[3], /no recent emergency snapshot/);
  assert.equal(h.storage.size, 0); h.cleanup();
});

function csvRows(text) {
  return text.replace(/^\uFEFF/, '').split('\r\n').map(line => {
    const cells = []; let value = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        if (quoted && line[i + 1] === '"') { value += '"'; i++; }
        else quoted = !quoted;
      } else if (line[i] === ',' && !quoted) { cells.push(value); value = ''; }
      else value += line[i];
    }
    cells.push(value); return cells;
  });
}

test('home-RC reporting deduplicates groups across houses, retains registration estimates and counts each admission', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(path.join('drizzle', file), 'utf8'));
    const db = databaseAdapter(sqlite);
    const load = moduleLoader({
      'cloudflare:workers': { env: { DB: db } },
      '@/lib/moderator-auth': { isOverallModerator: async () => true },
      '@/lib/operations': { recordSiteError: async () => {}, raiseAlert: async () => {}, resolveAlert: async () => {} },
    });
    const stats = load('@/lib/participant-stats').getHomeRcStats;
    const initial = await stats(db);
    assert.equal(initial.length, 6); assert.ok(initial.every(rc => rc.estimatedParticipants === 0 && rc.admissions === 0));
    const insert = sqlite.prepare(`INSERT INTO queue_entries (queue_number,device_token_hash,home_rc,house_code,nickname,group_size,status,joined_at,completed_at) VALUES (?,?,?,?,'test',?,?,?,?)`);
    const fixtures = [
      ['RV-0001','a','RV','RV',2,'entered'], ['CP-0001','a','RV','CP',4,'entered'],
      ['TM-0001','a','RV','TM',6,'cancelled'], ['R4-0001','a','RV','R4',3,'skipped'],
      ['AC-0001','b','RV','AC',5,'waiting'],
      ['RV-0002','c','CP','RV',3,'entered'], ['CP-0002','c','CP','CP',3,'entered'],
      ['NS-0001',null,'NS','NS',2,'entered'], ['CP-0003',null,'NS','CP',4,'entered'],
      ['RV-0003','u',null,'RV',7,'entered'], ['CP-0004','u',null,'CP',3,'waiting'],
      ['AC-0002','v','BAD','AC',1,'cancelled'], ['NS-0002','','RV','NS',2,'waiting'],
    ];
    for (const row of fixtures) insert.run(...row, Date.now(), row[5] === 'entered' ? Date.now() : null);
    sqlite.exec("INSERT INTO participant_devices (device_token_hash,home_rc) VALUES ('no-ticket','TM')");
    const values = await stats(db);
    const byRc = Object.fromEntries(values.map(rc => [rc.code, [rc.estimatedParticipants, rc.admissions]]));
    assert.deepEqual(Array.from(byRc.RV), [13, 6]);
    assert.deepEqual(Array.from(byRc.CP), [3, 6]);
    assert.deepEqual(Array.from(byRc.NS), [6, 6]);
    assert.deepEqual(Array.from(byRc.TM), [0, 0]);
    assert.deepEqual(Array.from(byRc.UNKNOWN), [8, 7]);
    assert.equal(values.reduce((sum, rc) => sum + rc.estimatedParticipants, 0), 30);
    const dashboard = load('@/app/api/moderator/overall/route');
    const data = await (await dashboard.GET(new Request('https://test/overall'))).json();
    assert.deepEqual(data.homeRcStats, JSON.parse(JSON.stringify(values)));
    assert.equal(data.homeRcStats.reduce((sum, rc) => sum + rc.admissions, 0), data.houses.reduce((sum, house) => sum + house.enteredParticipants, 0));
    const exportRoute = load('@/app/api/moderator/overall/export/route');
    const exported = await exportRoute.GET(new Request('https://test/export'));
    assert.equal(exported.status, 200); assert.match(exported.headers.get('cache-control'), /no-store/);
    const rows = csvRows(await exported.text()), header = rows[0];
    assert.ok(rows.every(row => row.length === header.length));
    const summaryRows = rows.slice(1).filter(row => row[0] === 'home_rc_summary');
    assert.equal(summaryRows.length, 7);
    for (const rc of data.homeRcStats) {
      const csv = summaryRows.find(row => row[header.indexOf('home_rc')] === rc.name);
      assert.equal(Number(csv[header.indexOf('estimated_participants')]), rc.estimatedParticipants);
      assert.equal(Number(csv[header.indexOf('haunted_house_admissions')]), rc.admissions);
    }
    assert.equal(rows.filter(row => row[0] === 'participant_summary').length, 6);
    assert.ok(!header.includes('device_token_hash')); assert.ok(!header.includes('nickname'));
    // Undo changes admissions, while registrations remain counted, even if tickets are cancelled.
    sqlite.exec("UPDATE queue_entries SET status = 'waiting', completed_at = NULL WHERE queue_number = 'CP-0001'");
    let updated = (await stats(db)).find(rc => rc.code === 'RV');
    assert.equal(updated.estimatedParticipants, 13); assert.equal(updated.admissions, 2);
    sqlite.exec("UPDATE queue_entries SET status = 'cancelled' WHERE device_token_hash = 'a'");
    updated = (await stats(db)).find(rc => rc.code === 'RV');
    assert.equal(updated.estimatedParticipants, 13); assert.equal(updated.admissions, 0);
  } finally { sqlite.close(); }
});

test('home-RC event statistics stay restricted to overall moderators', async () => {
  const load = moduleLoader({
    'cloudflare:workers': { env: {} },
    '@/lib/moderator-auth': { isOverallModerator: async () => false },
  });
  const request = new Request('https://test/overall');
  assert.equal((await load('@/app/api/moderator/overall/route').GET(request)).status, 401);
  assert.equal((await load('@/app/api/moderator/overall/export/route').GET(request)).status, 401);
});
