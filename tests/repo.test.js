// Unit tests of the camp cache (lib/campRepo.js) on the in-memory store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../db/memoryStore.js';
import { createCampRepo } from '../lib/campRepo.js';
import { normalizeTeam, recomputeTeamScore } from '../lib/campLogic.js';

const parse = raw => { raw.teams.forEach(t => { normalizeTeam(t); recomputeTeamScore(t); }); return raw; };
const tick = () => new Promise(r => setTimeout(r, 20));

function setup() {
    const store = createMemoryStore();
    const events = { changes: 0, instant: [] };
    const repo = createCampRepo(store, {
        parse, publicView: c => ({ teams: c.teams }),
        onChange: () => { events.changes++; }, onInstant: (id, e, log) => events.instant.push(log.id)
    });
    return { store, repo, events };
}

test('a score written by another instance during a change is kept', async () => {
    const { store, repo } = setup();
    await repo.create('c1', { id: 'c1', title: 'x', teams: [{ id: 't1', name: 'A' }] });
    const entry = await repo.get('c1');
    const { camp, baseLogs } = repo.snapshot(entry);
    // Another server records a score (log only) while this one is busy.
    await store.commit('c1', { logSet: [{ id: 'log_other', teamId: 't1', type: 'instant', value: 5, timestamp: Date.now() }] });
    await tick();
    camp.teams[0].name = 'Renamed';
    await repo.commit(entry, { teams: camp.teams }, { baseLogs });
    const logs = await store.getCampLogs('c1');
    assert.deepEqual(logs.map(l => l.id), ['log_other']);
    const now = repo.campOf(await repo.get('c1'));
    assert.equal(now.teams[0].name, 'Renamed');
    assert.equal(now.teams[0].score, 5);
});

test('only changed logs are written; the camp document is untouched by a score', async () => {
    const { store, repo, events } = setup();
    await repo.create('c2', { id: 'c2', title: 'x', teams: [{ id: 't1', name: 'A' }] });
    const entry = await repo.get('c2');
    const rev = entry.rev;
    const { camp } = repo.snapshot(entry);
    camp.teams[0].scoreLogs.push({ id: 'log_a', type: 'instant', value: 2, timestamp: Date.now(), createdAt: Date.now() });
    await repo.commit(entry, { teams: camp.teams });
    assert.equal(entry.rev, rev, 'no document write for a score');
    assert.deepEqual(events.instant, ['log_a']);
    await tick();
    assert.deepEqual(events.instant, ['log_a'], 'the watcher echo is not a second splash');
    assert.equal((await store.getCampDoc('c2')).rev, rev);
    const { etag } = repo.jsonOf(entry);
    const again = repo.snapshot(entry);
    await repo.commit(entry, { teams: again.camp.teams }); // nothing changed
    assert.equal(repo.jsonOf(entry).etag, etag);
});

test('images are stored once and referenced by URL', async () => {
    const { store, repo } = setup();
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await repo.create('c3', { id: 'c3', logo: png, teams: [{ id: 't1', name: 'A', image: png }] });
    const doc = (await store.getCampDoc('c3')).doc;
    assert.match(doc.logo, /^\/media\/[a-f0-9]{32}\.png$/);
    assert.equal(doc.teams[0].image, doc.logo);
    const m = await store.getMedia(doc.logo.slice(7));
    assert.equal(m.data.length, 70);
});
