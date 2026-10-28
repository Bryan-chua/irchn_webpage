// Authorized live-event acceptance/load test. Credentials stay outside the repo.
// IRCHN_TEST_CREDENTIALS=/private/path.json node tests/live-event.mjs
// Creates up to 1,200 tickets, then closes every queue. Run the separate documented
// D1 reset after inspecting the report to remove all test records.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const base = 'https://irchn-queue.rvrc.workers.dev';
const out = process.env.IRCHN_TEST_OUTPUT || '/private/tmp/irchn-live-test';
const pins = JSON.parse(await fs.readFile(process.env.IRCHN_TEST_CREDENTIALS || `${out}/credentials.json`, 'utf8'));
const codes = ['RV', 'CP', 'AC', 'TM', 'R4', 'NS'];
const names = ['RVRC', 'CAPT', 'Acacia', 'Tembusu', 'RC4', 'NUSC'];
const runId = `LIVE-TEST-${Date.now()}`;
const report = { runId, base, startedAt: Date.now(), checks: [], phases: [], requests: [], problems: [], tickets: [], deviceHashes: [] };
const cookies = {};
let originalEvent, originalAnnouncement;
const ownedQueueNumbers = new Set();
let loadPoolActive = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function req(path, { method = 'GET', body, scope, cookie, label = path } = {}) {
  const start = performance.now();
  try {
    const response = await fetch(`${base}${path}`, { method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie || cookies[scope] ? { cookie: cookie || cookies[scope] } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'manual' });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (path === '/api/queues' && data?.ticket?.queueNumber) ownedQueueNumbers.add(data.ticket.queueNumber);
    report.requests.push({ label, status: response.status, ms: Math.round(performance.now() - start) });
    return { status: response.status, data, headers: response.headers };
  } catch (error) {
    report.requests.push({ label, status: 'network_error', ms: Math.round(performance.now() - start), error: error.message });
    throw error;
  }
}
async function expect(path, status, options) {
  const result = await req(path, options);
  assert.equal(result.status, status, `${options?.label || path}: ${JSON.stringify(result.data).slice(0, 200)}`);
  return result;
}
async function check(name, fn) {
  const start = performance.now();
  try { await fn(); report.checks.push({ name, pass: true, ms: Math.round(performance.now() - start) }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, pass: false, error: error.message }); report.problems.push({ check: name, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
}
const overall = body => expect('/api/moderator/overall', 200, { method: 'PATCH', body, scope: 'OVERALL' });
const station = (code, body, status = 200) => expect('/api/moderator/queue', status, { method: 'PATCH', body, scope: code });
async function device(homeRc) {
  const deviceToken = crypto.randomUUID();
  report.deviceHashes.push(Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(deviceToken))).toString('hex'));
  const result = await expect('/api/participant', 200, { method: 'POST', body: { deviceToken, homeRc }, label: 'profile' });
  assert.equal(result.data.homeRc, homeRc);
  return deviceToken;
}
async function join(houseCode, deviceToken, extras = {}, expected = 201) {
  const body = { houseCode, nickname: `${runId.slice(0, 23)}-${houseCode}`, groupSize: houseCode === 'TM' ? 4 : 2, deviceToken, joinKey: crypto.randomUUID(), ...extras };
  const result = await expect('/api/queues', expected, { method: 'POST', body, label: 'join' });
  if (result.data.ticket) report.tickets.push({ ...result.data.ticket, deviceToken, joinKey: body.joinKey });
  return result.data.ticket;
}
async function readTicket(number) { return (await expect(`/api/queues/${encodeURIComponent(number)}`, 200, { label: 'ticket' })).data.ticket; }
async function queue(code) {
  const data = (await expect('/api/moderator/queue', 200, { scope: code, label: 'station_poll' })).data;
  const unknown = data.active.filter(entry => !ownedQueueNumbers.has(entry.queueNumber));
  if (!loadPoolActive && unknown.length) throw new Error(`Non-test tickets appeared at ${code}; stopping queue actions to preserve them.`);
  return data;
}
async function pool(count, concurrency, fn) {
  let next = 0, failure;
  loadPoolActive = true;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < count && !failure) {
      const index = next++;
      try { await fn(index); } catch (error) { failure ||= error; }
    }
  }));
  loadPoolActive = false;
  if (failure) throw failure;
}
function parseCsv(text) {
  return text.replace(/^\uFEFF/, '').split('\r\n').map(line => {
    const cells = []; let value = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { if (quoted && line[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
      else if (line[i] === ',' && !quoted) { cells.push(value); value = ''; } else value += line[i];
    }
    cells.push(value); return cells;
  });
}
async function verifyRcReport() {
  const data = (await expect('/api/moderator/overall', 200, { scope: 'OVERALL' })).data;
  const stats = data.homeRcStats;
  assert.equal(stats.reduce((sum, rc) => sum + rc.admissions, 0), data.houses.reduce((sum, house) => sum + house.enteredParticipants, 0));
  const csv = parseCsv((await expect('/api/moderator/overall/export', 200, { scope: 'OVERALL' })).data);
  const header = csv[0];
  assert.ok(csv.every(row => row.length === header.length));
  const rows = csv.slice(1).filter(row => row[0] === 'home_rc_summary');
  assert.equal(rows.length, stats.length);
  for (const rc of stats) {
    const row = rows.find(row => row[header.indexOf('home_rc')] === rc.name);
    assert.ok(row, rc.name);
    assert.equal(Number(row[header.indexOf('estimated_participants')]), rc.estimatedParticipants);
    assert.equal(Number(row[header.indexOf('haunted_house_admissions')]), rc.admissions);
  }
  return stats;
}
async function saveReport() {
  const timings = report.requests.filter(r => r.label === 'load_join').map(r => r.ms).sort((a, b) => a - b);
  const quantile = p => timings.length ? timings[Math.min(timings.length - 1, Math.floor(timings.length * p))] : null;
  report.summary = { checksPassed: report.checks.filter(c => c.pass).length, checksFailed: report.checks.filter(c => !c.pass).length,
    requests: report.requests.length, serverErrors: report.requests.filter(r => Number(r.status) >= 500).length,
    networkErrors: report.requests.filter(r => r.status === 'network_error').length, loadJoinP50: quantile(.5), loadJoinP95: quantile(.95), loadJoinP99: quantile(.99), loadJoinMax: timings.at(-1) ?? null };
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
}

try {
  await check('all seven moderator logins and secure scoped cookies', async () => {
    for (const code of [...codes, 'OVERALL']) {
      const result = await expect('/api/moderator/login', 200, { method: 'POST', body: { houseCode: code, pin: pins[code] }, label: 'login' });
      const setCookie = result.headers.get('set-cookie');
      assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Strict/);
      cookies[code] = setCookie.split(';')[0];
      assert.equal(result.data.houseCode, code);
    }
    await fs.writeFile(`${out}/cookies.json`, JSON.stringify(cookies), { mode: 0o600 });
  });
  if (!cookies.OVERALL) throw new Error('Cannot test without overall access.');
  const original = (await expect('/api/moderator/overall', 200, { scope: 'OVERALL' })).data;
  originalEvent = original.event;
  report.original = original;
  assert.ok(original.houses.every(house => house.waitingCount === 0 && house.skippedCount === 0 && house.enteredGroups === 0), 'The full live test requires an empty queue baseline.');
  originalAnnouncement = (await expect('/api/announcement', 200)).data.announcement;
  await overall({ globalStatus: 'closed' });
  await overall({ homeRcOnlyAt: null });

  await check('public pages, all join pages and share assets respond', async () => {
    for (const path of ['/', '/moderator', ...codes.map(c => `/join/${c.toLowerCase()}`), '/favicon.svg', '/og.png']) await expect(path, 200);
    const houses = await expect('/api/houses', 200);
    assert.deepEqual(houses.data.houses.map(h => h.code), codes);
    assert.match(houses.headers.get('cache-control'), /max-age=3/);
  });
  await check('authentication and station isolation', async () => {
    for (const path of ['/api/moderator/queue', '/api/moderator/overall', '/api/moderator/overall/export', '/api/moderator/overall/emergency-export']) await expect(path, 401);
    await expect('/api/moderator/overall', 401, { scope: 'RV' });
    await expect('/api/moderator/queue', 401, { scope: 'OVERALL' });
    await expect('/api/announcement', 401, { method: 'PUT', scope: 'RV', body: { title: 'test', message: 'test' } });
    await expect('/api/moderator/overall', 401, { cookie: 'nof_moderator=OVERALL.9999999999999.' + '0'.repeat(64) });
    for (const code of codes) assert.equal((await queue(code)).houseCode, code);
  });
  await check('global close/pause locks station controls and rejects new joins', async () => {
    const token = await device('RV');
    await join('RV', token, {}, 409);
    await station('RV', { queueStatus: 'open' }, 423);
    await overall({ globalStatus: 'paused' });
    const data = (await expect('/api/moderator/overall', 200, { scope: 'OVERALL' })).data;
    assert.ok(data.houses.every(h => h.status === 'paused')); assert.equal(data.event.stationControlsLocked, true);
    await join('RV', token, {}, 409);
    await overall({ houseCode: 'RV', houseStatus: 'open' }).then(() => { throw new Error('Locked individual status unexpectedly succeeded'); }, error => { assert.match(error.message, /423|unlock/i); });
    await overall({ globalStatus: 'open' });
    assert.equal((await queue('RV')).stationControlsLocked, false);
  });
  await check('profile validation, persistence, fixed RC and required profile on joins', async () => {
    await expect('/api/participant', 400, { method: 'POST', body: { deviceToken: 'invalid', homeRc: 'RV' } });
    await expect('/api/participant', 400, { method: 'POST', body: { deviceToken: crypto.randomUUID(), homeRc: 'BAD' } });
    const token = await device('RV');
    const changed = await expect('/api/participant', 200, { method: 'POST', body: { deviceToken: token, homeRc: 'CP' } });
    assert.equal(changed.data.homeRc, 'RV');
    const saved = await expect('/api/participant', 200, { method: 'POST', body: { deviceToken: token } }); assert.equal(saved.data.homeRc, 'RV');
    await join('RV', crypto.randomUUID(), {}, 400);
    await join('RV', token, { deviceToken: 'bad' }, 400);
    await join('RV', token, { joinKey: 'bad' }, 400);
    await join('BAD', token, {}, 400);
    await join('RV', token, { nickname: 'a' }, 400);
    await join('RV', token, { nickname: 'x'.repeat(31) }, 400);
  });
  const fixtures = {};
  await check('group limits, first ticket, nickname privacy and normalized lookup at all six houses', async () => {
    for (const code of codes) {
      const token = await device(code);
      const min = code === 'TM' ? 4 : 1, max = code === 'R4' ? 5 : 8;
      await join(code, token, { groupSize: min - 1 }, 400);
      await join(code, token, { groupSize: max + 1 }, 400);
      await join(code, token, { groupSize: 2.5 }, 400);
      const created = await join(code, token, { groupSize: min, nickname: '=LIVE-TEST,"team"' });
      fixtures[code] = created;
      assert.match(created.queueNumber, new RegExp(`^${code}-[0-9]{4}$`));
      assert.equal(created.status, 'waiting'); assert.equal(created.groupsAhead, 0); assert.equal(created.groupSize, min);
      assert.equal(created.nickname, '=LIVE-TEST,"team"');
      const publicResult = await expect(`/api/queues/${encodeURIComponent(' ' + created.queueNumber.toLowerCase().replace('-', ' - ') + ' ')}`, 200);
      assert.equal(publicResult.data.ticket.queueNumber, created.queueNumber); assert.equal(publicResult.data.ticket.nickname, undefined);
      assert.match(publicResult.headers.get('cache-control'), /no-store/);
      const stationData = await queue(code); assert.equal(stationData.active.find(e => e.queueNumber === created.queueNumber).nickname, created.nickname);
    }
    await expect('/api/queues/RV-NONEXISTENT', 404);
  });
  await check('concurrent retries issue one ticket per browser/house and support multiple houses', async () => {
    const token = await device('RV'), joinKey = crypto.randomUUID();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => req('/api/queues', { method: 'POST', body: { houseCode: 'RV', nickname: 'LIVE-TEST concurrency', groupSize: 2, deviceToken: token, joinKey: i < 10 ? joinKey : crypto.randomUUID() }, label: 'concurrent_duplicate' })));
    assert.ok(results.every(r => [200, 201].includes(r.status)), JSON.stringify(results.map(r => r.status)));
    assert.equal(new Set(results.map(r => r.data.ticket.queueNumber)).size, 1);
    const entries = await queue('RV'); assert.equal(entries.active.filter(e => e.queueNumber === results[0].data.ticket.queueNumber).length, 1);
    const second = await join('CP', token); assert.equal(second.houseCode, 'CP');
    const retry = await join('RV', token, { joinKey }, 200); assert.equal(retry.queueNumber, results[0].data.ticket.queueNumber);
  });
  await check('every station: bulk enter/skip, Undo, original order, estimates and history', async () => {
    for (const code of codes) {
      const first = fixtures[code];
      const second = await join(code, await device(code));
      const third = await join(code, await device(code));
      const q = await queue(code);
      const ids = [first, second].map(t => q.active.find(e => e.queueNumber === t.queueNumber).id);
      const aheadBefore = (await readTicket(third.queueNumber)).groupsAhead;
      await station(code, { ids, status: 'skipped' });
      assert.equal((await readTicket(first.queueNumber)).status, 'skipped');
      assert.equal((await readTicket(third.queueNumber)).groupsAhead, aheadBefore - 2);
      await station(code, { ids, status: 'waiting' });
      assert.equal((await readTicket(third.queueNumber)).groupsAhead, aheadBefore);
      await station(code, { ids, status: 'entered' });
      const enteredQ = await queue(code);
      assert.ok(enteredQ.history.some(e => e.queueNumber === first.queueNumber)); assert.ok(enteredQ.lastEnteredAt > 0);
      await station(code, { ids: [ids[0]], status: 'waiting' });
      assert.equal((await readTicket(first.queueNumber)).status, 'waiting');
      assert.equal((await readTicket(first.queueNumber)).groupsAhead, 0);
      const current = await queue(code);
      assert.ok(current.active.filter(e => e.status === 'waiting').every((e, i, a) => !i || a[i - 1].id < e.id));
      assert.ok((await readTicket(third.queueNumber)).estimatedSeconds > 0);
      await station(code, { ids: [ids[0]], status: 'entered' });
      await station(code, { ids: [ids[0]], status: 'entered' }, 409);
    }
  });
  await check('cross-station ticket mutation is rejected', async () => {
    const cp = await queue('CP');
    const id = cp.active[0].id;
    await station('RV', { ids: [id], status: 'entered' }, 409);
    assert.equal((await readTicket(cp.active[0].queueNumber)).status, cp.active[0].status);
  });
  await check('individual house pause/close preserves tickets and blocks joins', async () => {
    const code = 'AC'; const token = await device(code);
    const ticket = fixtures[code];
    await station(code, { queueStatus: 'paused' });
    await join(code, token, {}, 409); assert.equal((await readTicket(ticket.queueNumber)).status, 'entered');
    await overall({ houseCode: code, houseStatus: 'closed' }); await join(code, token, {}, 409);
    await station(code, { queueStatus: 'open' }); const created = await join(code, token); assert.equal(created.status, 'waiting');
  });
  await check('closing-time capacity projection and validation', async () => {
    await expect('/api/moderator/overall', 400, { method: 'PATCH', scope: 'OVERALL', body: { eventEndAt: 'invalid' } });
    await overall({ eventEndAt: Date.now() + 3600000 });
    const data = (await expect('/api/moderator/overall', 200, { scope: 'OVERALL' })).data;
    assert.ok(data.houses.filter(h => h.waitingCount > 0).every(h => Number.isFinite(h.closingMarginMinutes)));
    await overall({ eventEndAt: originalEvent.eventEndAt });
  });
  await check('announcements publish, replace, public read, validate and remove', async () => {
    await expect('/api/announcement', 400, { method: 'PUT', scope: 'OVERALL', body: { title: '', message: 'test' } });
    await expect('/api/announcement', 400, { method: 'PUT', scope: 'OVERALL', body: { title: 'x'.repeat(101), message: 'test' } });
    await expect('/api/announcement', 400, { method: 'PUT', scope: 'OVERALL', body: { title: 'test', message: 'x'.repeat(2001) } });
    const first = (await expect('/api/announcement', 200, { method: 'PUT', scope: 'OVERALL', body: { title: 'Live system test', message: 'Organisers are testing the queue system. Test tickets will be removed before the event.' } })).data.announcement;
    const second = (await expect('/api/announcement', 200, { method: 'PUT', scope: 'OVERALL', body: { title: 'Live system test — updated', message: 'Testing announcements and queue operations before tonight’s event.' } })).data.announcement;
    assert.notEqual(first.version, second.version);
    assert.equal((await expect('/api/announcement', 200)).data.announcement.version, second.version);
    await expect('/api/announcement', 200, { method: 'DELETE', scope: 'OVERALL' });
    assert.equal((await expect('/api/announcement', 200)).data.announcement, null);
  });
  await check('CSV exports: entered totals, anonymous report, emergency ordering and formula escaping', async () => {
    const result = await expect('/api/moderator/overall/export', 200, { scope: 'OVERALL' });
    assert.match(result.headers.get('content-type'), /text\/csv/); assert.ok(!result.data.includes('LIVE-TEST concurrency'));
    for (const name of names) assert.ok(result.data.includes(`participant_summary,${name},`));
    const emergency = await expect('/api/moderator/overall/emergency-export', 200, { scope: 'OVERALL' });
    const rows = emergency.data.replace(/^\uFEFF/, '').split('\r\n').slice(1);
    for (const [i, code] of codes.entries()) {
      const active = (await queue(code)).active;
      const csvHouse = rows.filter(row => row.startsWith(names[i] + ','));
      assert.deepEqual(csvHouse.map(row => row.split(',')[2]), active.map(e => e.queueNumber));
    }
    // Seed one unprocessed formula-like nickname for spreadsheet escape validation.
    const formula = await join('NS', await device('NS'), { nickname: '=LIVE-TEST,"csv"' });
    const csv = (await expect('/api/moderator/overall/emergency-export', 200, { scope: 'OVERALL' })).data;
    assert.ok(csv.includes(`"'=LIVE-TEST,""csv"""`)); assert.ok(csv.includes(formula.queueNumber));
  });
  await check('failed-login rate limit, operational alert, acknowledgement and audit history', async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await req('/api/moderator/login', { method: 'POST', body: { houseCode: 'LIVE_TEST_INVALID_SCOPE', pin: 'INTENTIONAL-INVALID-TEST' }, label: 'invalid_login' }));
    assert.deepEqual(results.map(r => r.status), [401, 401, 401, 429]);
    assert.equal(results[3].headers.get('retry-after'), '60');
    const data = (await expect('/api/moderator/overall', 200, { scope: 'OVERALL' })).data;
    const alert = data.events.find(e => e.eventType === 'moderator_login_rate_limited' && e.houseCode === 'INVALID');
    assert.ok(alert); await overall({ acknowledgeEventId: alert.id });
    const updated = (await expect('/api/moderator/overall', 200, { scope: 'OVERALL' })).data;
    assert.ok(updated.events.find(e => e.id === alert.id).acknowledgedAt);
    assert.ok(updated.events.some(e => e.eventType === 'global_status_changed'));
  });

  await check('home-RC statistics deduplicate repeat visits, use the largest group and match the CSV', async () => {
    const before = await verifyRcReport();
    const token = await device('RV');
    const first = await join('RV', token, { groupSize: 2 });
    const second = await join('CP', token, { groupSize: 4 });
    await join('AC', token, { groupSize: 3 });
    const q1 = await queue('RV'), q2 = await queue('CP');
    const firstId = q1.active.find(entry => entry.queueNumber === first.queueNumber).id;
    const secondId = q2.active.find(entry => entry.queueNumber === second.queueNumber).id;
    let stats = await verifyRcReport();
    const baseline = before.find(rc => rc.code === 'RV');
    assert.equal(stats.find(rc => rc.code === 'RV').estimatedParticipants, baseline.estimatedParticipants + 4);
    assert.equal(stats.find(rc => rc.code === 'RV').admissions, baseline.admissions);
    await station('RV', { ids: [firstId], status: 'entered' });
    await station('CP', { ids: [secondId], status: 'entered' });
    stats = await verifyRcReport();
    assert.equal(stats.find(rc => rc.code === 'RV').admissions, baseline.admissions + 6);
    await station('CP', { ids: [secondId], status: 'waiting' });
    stats = await verifyRcReport();
    assert.equal(stats.find(rc => rc.code === 'RV').estimatedParticipants, baseline.estimatedParticipants + 4);
    assert.equal(stats.find(rc => rc.code === 'RV').admissions, baseline.admissions + 2);
    await station('RV', { ids: Array.from({ length: 101 }, (_, i) => i + 1), status: 'entered' }, 400);
  });
  if (report.checks.some(c => !c.pass)) throw new Error('Functional checks failed; skipping load until they are resolved.');
  const loadTickets = [];
  for (const [phase, concurrency] of [[1, 10], [2, 40]]) {
    const count = 600;
    const started = performance.now(); const requestStart = report.requests.length;
    console.log(`LOAD phase ${phase}: ${count} tickets, concurrency ${concurrency}`);
    let finished = 0;
    await pool(count, concurrency, async index => {
      const n = (phase - 1) * count + index;
      const code = codes[n % 6]; const homeRc = (Math.floor(n / 6) % 2 === 0) ? code : codes[(n % 6 + 1) % 6];
      const token = await device(homeRc);
      const body = { houseCode: code, nickname: `LIVE-TEST load ${n}`, groupSize: code === 'TM' ? 4 : 2, deviceToken: token, joinKey: crypto.randomUUID() };
      const result = await expect('/api/queues', 201, { method: 'POST', body, label: 'load_join' });
      loadTickets.push({ ...result.data.ticket, homeRc, deviceToken: token });
      report.tickets.push({ ...result.data.ticket, homeRc });
      if (index % 25 === 0) { await readTicket(result.data.ticket.queueNumber); await queue(code); }
      finished++;
      if (finished % 100 === 0) console.log(`LOAD phase ${phase}: ${finished}/${count}`);
    });
    const elapsed = performance.now() - started;
    const requests = report.requests.slice(requestStart);
    const phaseResult = { phase, count, concurrency, elapsedMs: Math.round(elapsed), ticketsPerSecond: +(count / (elapsed / 1000)).toFixed(2), requests: requests.length, errors: requests.filter(r => Number(r.status) >= 500 || r.status === 'network_error').length };
    report.phases.push(phaseResult); console.log(JSON.stringify(phaseResult));
    await saveReport();
  }
  await check('1,200 load tickets have unique numbers, correct totals and consistent positions', async () => {
    assert.equal(loadTickets.length, 1200); assert.equal(new Set(loadTickets.map(t => t.queueNumber)).size, 1200);
    const overallData = (await expect('/api/moderator/overall', 200, { scope: 'OVERALL' })).data;
    for (const code of codes) {
      const q = await queue(code), waiting = q.active.filter(e => e.status === 'waiting');
      assert.equal(q.active.filter(e => e.nickname.startsWith('LIVE-TEST load')).length, 200);
      assert.equal(overallData.houses.find(h => h.code === code).waitingCount, waiting.length);
      for (const index of [0, 1, Math.floor(waiting.length / 2), waiting.length - 1]) {
        const t = await readTicket(waiting[index].queueNumber); assert.equal(t.groupsAhead, index);
      }
    }
  });
  await check('home-RC statistics stay accurate with 1,200 load tickets', async () => {
    const stats = await verifyRcReport();
    for (const code of codes) {
      const expected = loadTickets.filter(t => t.homeRc === code).reduce((sum, t) => sum + t.groupSize, 0);
      assert.ok(stats.find(rc => rc.code === code).estimatedParticipants >= expected);
    }
    report.loadedRcStats = stats;
  });
  await check('loaded queues support 100-ticket bulk processing and restoration', async () => {
    for (const code of codes) {
      const q = await queue(code), ids = q.active.filter(e => e.status === 'waiting').slice(0, 100).map(e => e.id);
      await station(code, { ids, status: 'skipped' });
      const skipped = await queue(code); assert.equal(skipped.active.filter(e => ids.includes(e.id) && e.status === 'skipped').length, 100);
      await station(code, { ids, status: 'waiting' });
    }
  });
  await check('live scheduled cutoff clears outside RCs and rejects joins/undo while own RCs continue', async () => {
    const own = loadTickets.find(t => t.houseCode === 'RV' && t.homeRc === 'RV');
    const outside = loadTickets.find(t => t.houseCode === 'RV' && t.homeRc !== 'RV');
    const oldQ = await queue('RV');
    const outsideId = oldQ.active.find(e => e.queueNumber === outside.queueNumber).id;
    await station('RV', { ids: [outsideId], status: 'skipped' });
    const cutoff = Date.now() + 7000;
    await overall({ homeRcOnlyAt: cutoff });
    const profile = await expect('/api/participant', 200, { method: 'POST', body: { deviceToken: own.deviceToken } }); assert.equal(profile.data.homeRcOnlyAt, cutoff);
    assert.equal((await readTicket(outside.queueNumber)).status, 'skipped');
    await sleep(Math.max(0, cutoff - Date.now() + 400));
    const gone = await readTicket(outside.queueNumber); assert.equal(gone.status, 'cancelled'); assert.equal(gone.cancellationReason, 'rc_cutoff');
    assert.equal((await readTicket(own.queueNumber)).status, 'waiting');
    for (const code of codes) {
      const active = (await queue(code)).active;
      const shouldRemain = loadTickets.filter(t => t.houseCode === code && t.homeRc === code);
      const shouldCancel = loadTickets.filter(t => t.houseCode === code && t.homeRc !== code);
      assert.equal(shouldRemain.length, 100); assert.equal(shouldCancel.length, 100);
      assert.ok(shouldRemain.every(t => active.some(e => e.queueNumber === t.queueNumber)));
      assert.ok(shouldCancel.every(t => !active.some(e => e.queueNumber === t.queueNumber)));
    }
    await join('RV', outside.deviceToken, {}, 403);
    await station('RV', { ids: [outsideId], status: 'waiting' }, 409);
    const fresh = await device('RV'); await join('RV', fresh); await join('CP', fresh, {}, 403);
    await overall({ homeRcOnlyAt: null });
    assert.equal((await readTicket(outside.queueNumber)).status, 'cancelled');
    await join('CP', fresh);
  });
  await check('RC registration estimates survive cutoff cancellations and continue to match exports', async () => {
    const stats = await verifyRcReport();
    for (const rc of report.loadedRcStats) assert.ok(stats.find(row => row.code === rc.code).estimatedParticipants >= rc.estimatedParticipants);
  });
  await check('fresh emergency CSV excludes all cutoff-cancelled tickets', async () => {
    const csv = (await expect('/api/moderator/overall/emergency-export', 200, { scope: 'OVERALL' })).data;
    for (const t of loadTickets.filter(t => t.homeRc !== t.houseCode)) assert.ok(!csv.includes(t.queueNumber));
  });
  await check('logout expires the moderator cookie', async () => {
    const logout = await expect('/api/moderator/logout', 200, { method: 'POST', scope: 'NS' });
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  });
} catch (error) {
  report.problems.push({ check: 'run', error: error.stack }); console.log(`RUN STOPPED: ${error.message}`);
} finally {
  if (cookies.OVERALL) {
    for (const [name, action] of [
      ['close and lock all houses', () => overall({ globalStatus: 'closed' })],
      ['clear test cutoff', () => overall({ homeRcOnlyAt: originalEvent?.homeRcOnlyAt ?? null })],
      ['restore event closing time', () => overall({ eventEndAt: originalEvent?.eventEndAt ?? null })],
      ['restore announcement', () => originalAnnouncement ? expect('/api/announcement', 200, { method: 'PUT', scope: 'OVERALL', body: { title: originalAnnouncement.title, message: originalAnnouncement.message } }) : expect('/api/announcement', 200, { method: 'DELETE', scope: 'OVERALL' })],
    ]) {
      try { await action(); console.log(`RESTORED ${name}`); }
      catch (error) { report.problems.push({ check: `cleanup: ${name}`, error: error.message }); }
    }
    try { report.preReset = (await expect('/api/moderator/overall', 200, { scope: 'OVERALL' })).data; } catch {}
  }
  report.finishedAt = Date.now(); await saveReport();
  const hashes = [...new Set(report.deviceHashes)];
  const resetSql = [];
  for (let i = 0; i < hashes.length; i += 100) resetSql.push(`DELETE FROM queue_entries WHERE device_token_hash IN (${hashes.slice(i, i + 100).map(h => `'${h}'`).join(',')});`);
  for (let i = 0; i < hashes.length; i += 100) resetSql.push(`DELETE FROM participant_devices WHERE device_token_hash IN (${hashes.slice(i, i + 100).map(h => `'${h}'`).join(',')});`);
  resetSql.push(`DELETE FROM moderator_login_attempts WHERE last_failed_at >= ${report.startedAt};`);
  resetSql.push(`UPDATE operational_events SET resolved_at = ${Date.now()} WHERE category = 'alert' AND resolved_at IS NULL AND event_type IN ('queue_significantly_delayed', 'skipped_groups_high', 'join_traffic_high', 'moderator_login_rate_limited') AND occurred_at >= ${report.startedAt};`);
  await fs.writeFile(`${out}/reset.sql`, resetSql.join('\n'), { mode: 0o600 });
  console.log(JSON.stringify({ summary: report.summary, problems: report.problems, resetSql: `${out}/reset.sql` }, null, 2));
}
