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

function openingFixture(globals = {}, overrides = {}) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(path.join('drizzle', file), 'utf8'));
  const db = databaseAdapter(sqlite);
  sqlite.exec("UPDATE house_settings SET status = 'closed'; UPDATE event_settings SET status = 'closed', station_controls_locked = 1, event_end_at = NULL WHERE id = 1;");
  const load = moduleLoader({
    'cloudflare:workers': { env: { DB: db, JOIN_RATE_LIMITER: { limit: async () => ({ success: true }) } } },
    '@/lib/moderator-auth': { isOverallModerator: async () => true, moderatorHouse: async () => 'RV' },
    '@/lib/operations': { recordSiteError: async () => {}, recordActivity: async () => {}, recordStationPresence: async () => {}, raiseAlert: async () => {}, resolveAlert: async () => {} },
    ...overrides,
  }, globals);
  return { sqlite, db, load };
}

test('scheduled opening fires once, opens every house, unlocks controls and keeps later manual overrides', async () => {
  const { sqlite, db, load } = openingFixture();
  try {
    const { applyScheduledOpening } = load('@/lib/event-schedule');
    const opening = Date.now() + 60000;
    sqlite.prepare('UPDATE event_settings SET event_open_at = ? WHERE id = 1').run(opening);
    await applyScheduledOpening(db, opening - 1);
    assert.ok(sqlite.prepare('SELECT status FROM house_settings').all().every(h => h.status === 'closed'));
    assert.equal(sqlite.prepare('SELECT event_opened_at FROM event_settings').get().event_opened_at, null);
    await Promise.all(Array.from({ length: 10 }, () => applyScheduledOpening(db, opening)));
    assert.ok(sqlite.prepare('SELECT status FROM house_settings').all().every(h => h.status === 'open'));
    const setting = sqlite.prepare('SELECT * FROM event_settings').get();
    assert.equal(setting.status, 'open'); assert.equal(setting.station_controls_locked, 0); assert.equal(setting.event_opened_at, opening);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM operational_events WHERE event_type = 'scheduled_opening_applied'").get().count, 1);
    sqlite.exec("UPDATE house_settings SET status = 'paused' WHERE house_code = 'RV'; UPDATE event_settings SET status = 'closed', station_controls_locked = 1;");
    await applyScheduledOpening(db, opening + 60000);
    assert.equal(sqlite.prepare("SELECT status FROM house_settings WHERE house_code = 'RV'").get().status, 'paused');
    assert.equal(sqlite.prepare('SELECT status FROM event_settings').get().status, 'closed');
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM operational_events WHERE event_type = 'scheduled_opening_applied'").get().count, 1);
  } finally { sqlite.close(); }
});

test('overall dashboard can schedule, reschedule and clear opening; manual global controls cancel it', async () => {
  const { sqlite, load } = openingFixture();
  try {
    const route = load('@/app/api/moderator/overall/route');
    const patch = body => route.PATCH(new Request('https://test/overall', { method: 'PATCH', body: JSON.stringify(body) }));
    const now = Date.now(), opening = now + 3600000, end = now + 7200000, cutoff = now + 5400000;
    assert.equal((await patch({ eventEndAt: end })).status, 200);
    assert.equal((await patch({ homeRcOnlyAt: cutoff })).status, 200);
    for (const invalid of ['invalid', String(opening), 0, now - 1000, opening + .5, 8640000000000001]) assert.equal((await patch({ eventOpenAt: invalid })).status, 400);
    assert.equal((await patch({ eventOpenAt: end })).status, 400);
    assert.equal((await patch({ eventOpenAt: opening })).status, 200);
    let data = await (await route.GET(new Request('https://test/overall'))).json();
    assert.equal(data.event.eventOpenAt, opening); assert.equal(data.event.eventOpenedAt, null);
    assert.equal(data.event.status, 'closed'); assert.equal(data.event.stationControlsLocked, true);
    assert.ok(data.houses.every(h => h.status === 'closed'));
    assert.equal(data.event.homeRcOnlyAt, cutoff); assert.equal(data.event.eventEndAt, end);
    assert.equal((await patch({ eventEndAt: opening })).status, 400);
    assert.equal((await patch({ eventOpenAt: opening + 60000 })).status, 200);
    assert.equal(sqlite.prepare('SELECT event_open_at FROM event_settings').get().event_open_at, opening + 60000);
    assert.equal((await patch({ eventOpenAt: null })).status, 200);
    assert.equal(sqlite.prepare('SELECT event_open_at FROM event_settings').get().event_open_at, null);
    for (const status of ['paused', 'closed', 'open']) {
      assert.equal((await patch({ eventOpenAt: opening })).status, 200);
      assert.equal((await patch({ globalStatus: status })).status, 200);
      data = await (await route.GET(new Request('https://test/overall'))).json();
      assert.equal(data.event.eventOpenAt, null); assert.equal(data.event.eventOpenedAt, null);
      assert.ok(data.houses.every(h => h.status === status));
      assert.equal(data.event.homeRcOnlyAt, cutoff);
    }
  } finally { sqlite.close(); }
});

test('background worker opens houses without a dashboard or participant request, and ignores expired schedules', async () => {
  const { sqlite, db, load } = openingFixture({}, {
    'vinext/server/app-router-entry': { __esModule: true, default: { fetch: async () => new Response('app fetch preserved') } },
  });
  try {
    const now = Date.now();
    const worker = load('@/worker').default;
    sqlite.prepare('UPDATE event_settings SET event_open_at = ? WHERE id = 1').run(now - 1);
    await worker.scheduled({}, { DB: db });
    assert.equal(sqlite.prepare('SELECT status FROM event_settings').get().status, 'open');
    assert.ok(sqlite.prepare('SELECT status FROM house_settings').all().every(h => h.status === 'open'));
    assert.equal(await (await worker.fetch(new Request('https://test/'))).text(), 'app fetch preserved');
    sqlite.prepare("UPDATE event_settings SET event_open_at = ?, event_opened_at = NULL, event_end_at = ?, status = 'closed', station_controls_locked = 1 WHERE id = 1").run(now - 60000, now - 1000);
    sqlite.exec("UPDATE house_settings SET status = 'closed'");
    await worker.scheduled({}, { DB: db });
    assert.ok(sqlite.prepare('SELECT status FROM house_settings').all().every(h => h.status === 'closed'));
    assert.equal(sqlite.prepare('SELECT event_opened_at FROM event_settings').get().event_opened_at, null);
  } finally { sqlite.close(); }
});

test('a public queue request applies a due opening when the background check has not run', async () => {
  const { sqlite, load } = openingFixture({ caches: { default: { match: async () => null, put: async () => {} } } });
  try {
    sqlite.prepare('UPDATE event_settings SET event_open_at = ? WHERE id = 1').run(Date.now() - 1);
    const houses = load('@/app/api/houses/route');
    const result = await houses.GET(new Request('https://test/api/houses'));
    assert.equal(result.status, 200); assert.ok((await result.json()).houses.every(h => h.status === 'open'));
    const station = load('@/app/api/moderator/queue/route');
    const control = await station.PATCH(new Request('https://test/station', { method: 'PATCH', body: JSON.stringify({ queueStatus: 'paused' }) }));
    assert.equal(control.status, 200);
    assert.equal(sqlite.prepare("SELECT status FROM house_settings WHERE house_code = 'RV'").get().status, 'paused');
  } finally { sqlite.close(); }
});

test('scheduled opening is restricted to the overall moderator', async () => {
  const { sqlite, load } = openingFixture({}, { '@/lib/moderator-auth': { isOverallModerator: async () => false } });
  try {
    const response = await load('@/app/api/moderator/overall/route').PATCH(new Request('https://test/overall', { method: 'PATCH', body: JSON.stringify({ eventOpenAt: Date.now() + 3600000 }) }));
    assert.equal(response.status, 401);
    assert.equal(sqlite.prepare('SELECT event_open_at FROM event_settings').get().event_open_at, null);
  } finally { sqlite.close(); }
});

function homepageHarness(ownRcOnly = false) {
  const state = [], effects = [], timers = new Map(), windowListeners = new Map(), documentListeners = new Map(), requests = [];
  let stateIndex = 0, timerId = 0, serverStatus = 'open', hold;
  const document = { hidden: false, addEventListener: (type, fn) => documentListeners.set(type, fn), removeEventListener: type => documentListeners.delete(type) };
  const jsx = (type, props) => ({ type, props });
  const load = moduleLoader({
    react: {
      useState(initial) { const i = stateIndex++; if (i >= state.length) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
      useEffect: fn => effects.push(fn),
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/InfoDrawer': { __esModule: true, default: () => null },
    './ParticipantPopupProvider': { useParticipantPopups: () => ({ homeRc: 'RV', homeRcOnlyAt: null, ownRcOnly }) },
    '@/docs/participant.md?raw': '',
  }, {
    document, AbortController,
    window: { addEventListener: (type, fn) => windowListeners.set(type, fn), removeEventListener: type => windowListeners.delete(type) },
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      requests.push({ url, options });
      const status = serverStatus;
      if (hold) await Promise.race([hold, new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))]);
      const houses = load('@/lib/houses').HOUSES.map(house => ({ ...house, status, waitingCount: 0, estimatedMinutes: 0, isDelayed: false }));
      return { ok: true, json: async () => ({ houses }) };
    },
  });
  const component = load('@/components/HomeClient.tsx').default;
  const render = () => { stateIndex = 0; return component(); };
  const nodes = (node, predicate) => !node || typeof node !== 'object' ? [] : [...(predicate(node) ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => nodes(child, predicate))];
  render(); const cleanup = effects[0]();
  return { state, timers, document, windowListeners, documentListeners, requests, cleanup, render, nodes,
    change: status => { serverStatus = status; }, hold: promise => { hold = promise; },
    async poll() {
      const entry = [...timers].find(([, timer]) => timer.delay >= 3200 && timer.delay <= 4800);
      assert.ok(entry, 'visible house cards must keep polling about every four seconds');
      timers.delete(entry[0]); entry[1].fn(); await setImmediate();
    },
  };
}

test('homepage cards close and disable join links on the next poll without a reload', async () => {
  const h = homepageHarness(); await setImmediate();
  assert.ok(h.state[0].every(house => house.status === 'open'));
  assert.ok(h.requests.every(r => r.options.cache === 'no-store'));
  h.change('closed'); await h.poll();
  assert.ok(h.state[0].every(house => house.status === 'closed'));
  const cards = h.nodes(h.render(), node => node.type === 'a' && node.props.className?.startsWith('house-card'));
  assert.equal(cards.length, 6); assert.ok(cards.every(card => card.props['aria-disabled'] && card.props.href === undefined));
  h.change('open'); await h.poll();
  assert.ok(h.state[0].every(house => house.status === 'open')); h.cleanup();
});

test('homepage refreshes immediately on tab return, focus, reconnect and back navigation', async () => {
  const h = homepageHarness(); await setImmediate();
  h.document.hidden = true; h.documentListeners.get('visibilitychange')();
  assert.equal(h.timers.size, 0);
  const before = h.requests.length; h.windowListeners.get('focus')(); await setImmediate(); assert.equal(h.requests.length, before);
  h.change('closed'); h.document.hidden = false; h.documentListeners.get('visibilitychange')(); await setImmediate();
  assert.equal(h.requests.at(-1).url, '/api/houses?fresh=1'); assert.ok(h.state[0].every(house => house.status === 'closed'));
  for (const event of ['focus', 'online', 'pageshow']) {
    const count = h.requests.length; h.windowListeners.get(event)(); await setImmediate();
    assert.equal(h.requests.length, count + 1); assert.equal(h.requests.at(-1).url, '/api/houses?fresh=1');
  }
  h.cleanup(); assert.equal(h.timers.size, 0); assert.equal(h.windowListeners.size, 0); assert.equal(h.documentListeners.size, 0);
});

test('homepage queues a fresh return-to-tab check behind an in-flight poll and cancels work on unmount', async () => {
  const h = homepageHarness(); await setImmediate();
  let release; h.hold(new Promise(resolve => { release = resolve; }));
  const poll = h.poll(); await setImmediate();
  const inFlight = h.requests.length;
  h.change('closed'); h.windowListeners.get('focus')(); h.windowListeners.get('online')();
  assert.equal(h.requests.length, inFlight);
  release(); await poll; await setImmediate();
  assert.equal(h.requests.length, inFlight + 1); assert.equal(h.requests.at(-1).url, '/api/houses?fresh=1');
  assert.ok(h.state[0].every(house => house.status === 'closed'));
  h.hold(new Promise(() => {})); const pending = h.poll(); await setImmediate();
  const count = h.requests.length; h.cleanup(); await pending; await setImmediate();
  assert.equal(h.requests.length, count); assert.equal(h.timers.size, 0);
});

test('a hung homepage request times out and polling retries automatically', async () => {
  const h = homepageHarness(); await setImmediate();
  h.hold(new Promise(() => {})); await h.poll();
  const timeout = [...h.timers].find(([, timer]) => timer.delay === 10000);
  assert.ok(timeout); h.timers.delete(timeout[0]); timeout[1].fn(); await setImmediate();
  assert.ok([...h.timers.values()].some(timer => timer.delay >= 6400 && timer.delay <= 9600));
  h.cleanup();
});

test('house responses disable browser caching while preserving edge cache and bypassing it for tab-return checks', async () => {
  let cached;
  const { sqlite, load } = openingFixture({ caches: { default: {
    match: async () => cached?.clone(), put: async (_key, response) => { cached = response; },
  } } });
  try {
    sqlite.exec("UPDATE house_settings SET status = 'open'");
    const route = load('@/app/api/houses/route');
    let response = await route.GET(new Request('https://test/api/houses'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(cached.headers.get('cache-control'), 'public, max-age=3');
    assert.ok((await response.json()).houses.every(house => house.status === 'open'));
    sqlite.exec("UPDATE house_settings SET status = 'closed'");
    response = await route.GET(new Request('https://test/api/houses'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok((await response.json()).houses.every(house => house.status === 'open')); // Shared cache still within its TTL.
    response = await route.GET(new Request('https://test/api/houses?fresh=1'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok((await response.json()).houses.every(house => house.status === 'closed'));
    response = await route.GET(new Request('https://test/api/houses'));
    assert.ok((await response.json()).houses.every(house => house.status === 'closed'));
  } finally { sqlite.close(); }
});


test('Closed labels take priority over Residents only after the RC cutoff', async () => {
  const h = homepageHarness(true); await setImmediate();
  let pills = h.nodes(h.render(), node => node.type === 'span' && node.props.className?.startsWith('open-pill'));
  assert.equal(pills.filter(pill => pill.props.children.includes('Residents only')).length, 5);
  h.change('closed'); await h.poll();
  pills = h.nodes(h.render(), node => node.type === 'span' && node.props.className?.startsWith('open-pill'));
  assert.equal(pills.length, 6); assert.ok(pills.every(pill => pill.props.children.includes('closed')));
  h.cleanup();
});

test('automatic closing runs once, locks all houses and keeps existing tickets viewable', async () => {
  const { sqlite, db, load } = openingFixture();
  try {
    const { applyEventSchedule } = load('@/lib/event-schedule');
    const closing = Date.now() + 60000;
    sqlite.prepare("UPDATE event_settings SET status = 'open', station_controls_locked = 0, event_end_at = ? WHERE id = 1").run(closing);
    sqlite.exec("UPDATE house_settings SET status = 'open'; INSERT INTO queue_entries (queue_number,home_rc,house_code,nickname,group_size,joined_at) VALUES ('RV-1212','RV','RV','existing',2,1)");
    await applyEventSchedule(db, closing - 1);
    assert.ok(sqlite.prepare('SELECT status FROM house_settings').all().every(h => h.status === 'open'));
    await Promise.all(Array.from({ length: 10 }, () => applyEventSchedule(db, closing)));
    assert.ok(sqlite.prepare('SELECT status FROM house_settings').all().every(h => h.status === 'closed'));
    const event = sqlite.prepare('SELECT * FROM event_settings').get();
    assert.equal(event.status, 'closed'); assert.equal(event.station_controls_locked, 1); assert.equal(event.event_closed_at, closing);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM operational_events WHERE event_type = 'scheduled_closing_applied'").get().count, 1);
    const ticket = await load('@/app/api/queues/[queueNumber]/route').GET(new Request('https://test/ticket'), { params: Promise.resolve({ queueNumber: 'RV-1212' }) });
    assert.equal(ticket.status, 200); assert.equal((await ticket.json()).ticket.status, 'waiting');
    // An intentional overall override after closing has fired is respected.
    sqlite.exec("UPDATE event_settings SET status = 'open', station_controls_locked = 0; UPDATE house_settings SET status = 'open'");
    await applyEventSchedule(db, closing + 60000);
    assert.ok(sqlite.prepare('SELECT status FROM house_settings').all().every(h => h.status === 'open'));
  } finally { sqlite.close(); }
});

test('closing settings can be changed, cleared and rearmed, with immediate closing for an elapsed time', async () => {
  const { sqlite, load } = openingFixture();
  try {
    const route = load('@/app/api/moderator/overall/route');
    const patch = body => route.PATCH(new Request('https://test/overall', { method: 'PATCH', body: JSON.stringify(body) }));
    await patch({ globalStatus: 'open' });
    const end = Date.now() + 3600000;
    assert.equal((await patch({ eventEndAt: end })).status, 200);
    assert.equal(sqlite.prepare('SELECT event_closed_at FROM event_settings').get().event_closed_at, null);
    assert.equal((await patch({ eventEndAt: Date.now() - 1000 })).status, 200);
    let data = await (await route.GET(new Request('https://test/overall'))).json();
    assert.equal(data.event.status, 'closed'); assert.ok(data.event.eventClosedAt); assert.equal(data.event.stationControlsLocked, true);
    assert.equal((await patch({ eventEndAt: null })).status, 200);
    data = await (await route.GET(new Request('https://test/overall'))).json();
    assert.equal(data.event.eventClosedAt, null); assert.equal(data.event.eventEndAt, null); assert.equal(data.event.status, 'closed');
    assert.equal((await patch({ eventEndAt: end })).status, 200);
    assert.equal(sqlite.prepare('SELECT event_closed_at FROM event_settings').get().event_closed_at, null);
  } finally { sqlite.close(); }
});

test('join inserts atomically reject manual closure, pause or the closing boundary after an open-status read', async () => {
  const { sqlite, db, load } = openingFixture();
  try {
    const token = crypto.randomUUID();
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
    sqlite.prepare("INSERT INTO participant_devices (device_token_hash,home_rc) VALUES (?,'RV')").run(hash);
    const originalPrepare = db.prepare.bind(db);
    let atInsert;
    db.prepare = sql => {
      const statement = originalPrepare(sql);
      if (sql.includes('INSERT INTO queue_entries')) {
        const originalRun = statement.run.bind(statement);
        statement.run = async () => { atInsert(); return originalRun(); };
      }
      return statement;
    };
    const join = load('@/app/api/queues/route');
    for (const action of [
      () => sqlite.exec("UPDATE house_settings SET status = 'closed' WHERE house_code = 'RV'"),
      () => sqlite.exec("UPDATE house_settings SET status = 'paused' WHERE house_code = 'RV'"),
      () => sqlite.prepare('UPDATE event_settings SET event_end_at = ? WHERE id = 1').run(Date.now() - 1000),
    ]) {
      sqlite.exec("UPDATE house_settings SET status = 'open'; UPDATE event_settings SET status = 'open', station_controls_locked = 0, event_end_at = NULL, event_closed_at = NULL");
      atInsert = action;
      const response = await join.POST(new Request('https://test/join', { method: 'POST', body: JSON.stringify({ houseCode: 'RV', nickname: 'boundary test', groupSize: 2, deviceToken: token, joinKey: crypto.randomUUID() }) }));
      assert.equal(response.status, 409); assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM queue_entries').get().count, 0);
    }
  } finally { sqlite.close(); }
});
