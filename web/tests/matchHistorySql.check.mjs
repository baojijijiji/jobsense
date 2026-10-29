// Optional real PostgreSQL-engine verification. Install PGlite in a temporary
// tool directory, then pass its dist/index.js path. No production connection.
// node tests/matchHistorySql.check.mjs node_modules/.history-sql-check/node_modules/@electric-sql/pglite/dist/index.js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { blankCareerDraft } from '../src/careerDraft.ts'
import { defaultTypography } from '../src/typography.ts'

const modulePath = process.argv[2] || process.env.PGLITE_MODULE_PATH
if (!modulePath) throw new Error('Pass the local PGlite dist/index.js path; this script never connects to a remote database.')
const { PGlite } = await import(pathToFileURL(resolve(modulePath)).href)
const db = new PGlite()
let passed = 0
const verify = async (name, work) => { await work(); passed++; process.stdout.write(`PASS ${name}\n`) }
const identity = async (role, id = '') => {
  await db.exec(`RESET ROLE; SET ROLE ${role}`)
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id])
}
const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const snapshot = (text = 'fictional original resume') => ({
  draft: { ...blankCareerDraft(), generated: true, jobText: 'fictional job description for analysis', matchedJob: 'fictional job description for analysis',
    sections: { ...blankCareerDraft().sections, 项目经历: text } },
  typography: { ...defaultTypography }, photoDataUrl: '',
})
const save = async (recordId, data, expectedVersion = null) => {
  const result = await db.query('SELECT * FROM public.jobsense_save_match_history($1::uuid, $2::text, $3::jsonb, $4::bigint)',
    [recordId, 'Fictional role', JSON.stringify(data), expectedVersion])
  assert.equal(result.rows.length, 1)
  return result.rows[0]
}
const rows = async () => (await db.query('SELECT id, user_id, version, original_snapshot, current_snapshot FROM public.jobsense_match_history ORDER BY created_at DESC, id DESC')).rows
const fails = (work, code) => assert.rejects(work, (error) => error.code === code)

try {
  await db.exec(`
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '') $$;
    GRANT USAGE ON SCHEMA auth, public TO authenticated, anon;
    CREATE TABLE public.jobsense_profiles(user_id varchar(64) PRIMARY KEY);
    INSERT INTO public.jobsense_profiles VALUES ('account-a'), ('account-b');
    ALTER TABLE public.jobsense_profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.jobsense_profiles FORCE ROW LEVEL SECURITY;
    GRANT SELECT ON public.jobsense_profiles TO authenticated;
    CREATE POLICY profiles_own ON public.jobsense_profiles FOR SELECT TO authenticated USING (user_id = auth.uid());
  `)
  await db.exec(await readFile(new URL('../database/cloudbase/005_match_history.sql', import.meta.url), 'utf8'))
  await identity('authenticated', 'account-a')
  const original = snapshot()

  await verify('31 creates retain exactly newest 30 and remove oldest', async () => {
    for (let index = 1; index <= 31; index++) await save(id(index), original)
    const result = await rows()
    assert.equal(result.length, 30)
    assert.equal(result.some((row) => row.id === id(1)), false)
    assert.equal(result[0].id, id(31))
  })

  await verify('create response retry is idempotent and does not evict another record', async () => {
    const saved = await save(id(31), original)
    assert.equal(Number(saved.version), 1)
    assert.equal((await rows()).length, 30)
  })

  const edited = snapshot('fictional edited resume')
  await verify('edit increments version and leaves original immutable', async () => {
    const saved = await save(id(31), edited, 1)
    assert.equal(Number(saved.version), 2)
    assert.deepEqual(saved.original_snapshot, original)
    assert.deepEqual(saved.current_snapshot, edited)
  })

  await verify('stale conflicting update is rejected and existing content survives', async () => {
    await fails(() => save(id(31), snapshot('stale device changes'), 1), '23505')
    assert.deepEqual((await rows()).find((row) => row.id === id(31)).current_snapshot, edited)
  })

  await verify('lost update response retry returns existing version without writing again', async () => {
    const saved = await save(id(31), edited, 1)
    assert.equal(Number(saved.version), 2)
    await fails(() => save(id(31), original, null), '23505')
  })

  await verify('updating a pruned row does not silently recreate it', async () => {
    await fails(() => save(id(1), original, 1), '23505')
    assert.equal((await rows()).length, 30)
    assert.equal((await rows()).some((row) => row.id === id(1)), false)
  })

  await verify('direct INSERT/UPDATE/DELETE cannot bypass RPC retention or original protection', async () => {
    await fails(() => db.query("UPDATE public.jobsense_match_history SET title = 'tampered'"), '42501')
    await fails(() => db.query('DELETE FROM public.jobsense_match_history'), '42501')
    await fails(() => db.query('INSERT INTO public.jobsense_match_history(user_id,id,title,original_snapshot,current_snapshot) VALUES ($1,$2,$3,$4,$4)',
      ['account-b', id(100), 'tampered', JSON.stringify(original)]), '42501')
  })

  await verify('second account cannot read first account rows and saves under its own identity', async () => {
    await identity('authenticated', 'account-b')
    assert.equal((await rows()).length, 0)
    const saved = await save(id(31), original)
    assert.equal(saved.user_id, 'account-b')
    assert.equal((await rows()).length, 1)
    const filtered = await db.query("SELECT id FROM public.jobsense_match_history WHERE user_id = 'account-a'")
    assert.equal(filtered.rows.length, 0)
    await identity('authenticated', 'account-a')
    assert.equal((await rows()).length, 30)
  })

  await verify('missing profile and empty identity cannot write history', async () => {
    await identity('authenticated', 'missing-account')
    await fails(() => save(id(101), original), '42501')
    await identity('authenticated', '')
    await fails(() => save(id(101), original), '28000')
  })

  await verify('anon cannot read history or invoke privileged save RPC', async () => {
    await identity('anon', '')
    await fails(() => rows(), '42501')
    await fails(() => save(id(101), original), '42501')
  })

  await verify('malformed or oversized snapshots are rejected by database', async () => {
    await identity('authenticated', 'account-a')
    await fails(() => save(id(102), { ...original, photoDataUrl: 'https://example.invalid/photo' }), '22023')
    await fails(() => save(id(102), { ...original, draft: { ...original.draft, generated: false } }), '22023')
    await fails(() => save(id(102), snapshot('x'.repeat(2_000_001))), '22023')
    assert.equal((await rows()).length, 30)
  })

  await verify('changed JD or matching revisions cannot be saved with an old resume', async () => {
    await fails(() => save(id(103), { ...original, draft: { ...original.draft, jobText: 'a different job description' } }), '22023')
    await fails(() => save(id(103), { ...original, draft: { ...original.draft, resumeJob: 'a different job description' } }), '22023')
    await fails(() => save(id(103), { ...original, draft: { ...original.draft, matchRevision: id(1) } }), '22023')
    const matching = { ...original, draft: { ...original.draft, jobText: '  ' + original.draft.jobText + ' ', matchRevision: id(1), resumeMatchRevision: id(1) } }
    const result = await save(id(103), matching)
    assert.equal(result.id, id(103))
  })

  process.stdout.write(`${passed} SQL checks passed in local PGlite; real simultaneous transaction scheduling and CloudBase REST remain untested.\n`)
} finally { await db.close() }
