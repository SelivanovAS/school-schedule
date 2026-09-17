const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('database enforces a single teacher and blocks student/anonymous writes', async () => {
  const db = new PGlite();
  const teacher = '11111111-1111-4111-8111-111111111111';
  const stranger = '22222222-2222-4222-8222-222222222222';
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      insert into auth.users values ('${teacher}'), ('${stranger}');
    `);
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/202609160001_teacher_homework.sql'), 'utf8'));
    await db.query('insert into school_private.teacher(user_id) values ($1)', [teacher]);
    await assert.rejects(db.query('insert into school_private.teacher(user_id) values ($1)', [stranger]), /duplicate key/);
    await assert.rejects(db.query('insert into school_private.teacher(slot,user_id) values (2,$1)', [stranger]), /check constraint/);
    const insert = "insert into public.assignments(subject,body,due_date) values ('Математика','№ 5','2026-09-18') returning *";

    await db.exec('set role anon');
    assert.equal((await db.query('select * from public.assignments')).rows.length, 0);
    await assert.rejects(db.query(insert), /permission denied/);
    await assert.rejects(db.query('select * from school_private.teacher'), /permission denied/);

    await db.exec('reset role; set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [stranger]);
    assert.equal((await db.query('select public.is_class_teacher() as allowed')).rows[0].allowed, false);
    await assert.rejects(db.query(insert), /row-level security/);
    await assert.rejects(db.query("insert into school_private.teacher(user_id) values ($1)", [stranger]), /permission denied/);

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [teacher]);
    assert.equal((await db.query('select public.is_class_teacher() as allowed')).rows[0].allowed, true);
    const item = (await db.query(insert)).rows[0];
    const updated = (await db.query("update public.assignments set body='№ 6' where id=$1 and version=1 returning *", [item.id])).rows[0];
    assert.equal(updated.version, 2);
    assert.equal((await db.query("update public.assignments set body='stale' where id=$1 and version=1 returning *", [item.id])).rows.length, 0);
    await assert.rejects(db.query('update public.assignments set version=1'), /permission denied/);
    await assert.rejects(db.query("update public.assignments set body=' '"), /check constraint/);

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [stranger]);
    assert.equal((await db.query('select * from public.assignments')).rows.length, 1);
    assert.equal((await db.query("update public.assignments set body='hack' returning *")).rows.length, 0);
    assert.equal((await db.query('delete from public.assignments returning *')).rows.length, 0);
    await db.exec('reset role; set role anon');
    assert.equal((await db.query('select body from public.assignments')).rows[0].body, '№ 6');
    await assert.rejects(db.query("update public.assignments set body='hack'"), /permission denied/);
    await assert.rejects(db.query('delete from public.assignments'), /permission denied/);

    // Изменение назначения отзывает запись даже у ранее вошедшего пользователя.
    await db.exec('reset role');
    await db.query('update school_private.teacher set user_id=$1', [stranger]);
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [teacher]);
    assert.equal((await db.query('select public.is_class_teacher() as allowed')).rows[0].allowed, false);
    await assert.rejects(db.query(insert), /row-level security/);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [stranger]);
    assert.equal((await db.query('delete from public.assignments returning *')).rows.length, 1);
  } finally { await db.close(); }
});
