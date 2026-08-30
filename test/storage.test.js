/*
 * The database is the one artefact a user cannot afford to lose. These tests
 * run against real SQLite, not a stand-in.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { schema, sqlEngine, boot } from './helpers/app.js';

const { create, migrations } = schema();

/** A database as it looked before the product and quote-line columns existed. */
function legacySchema() {
  return create
    .replace(/,\n  setup REAL DEFAULT 0[\s\S]*?rate REAL, watts REAL/, '')
    .replace(/,\n  productId TEXT, sku TEXT/, '')
    .replace(/, lang TEXT,/, ',');
}

async function open(sql) {
  const SQL = await sqlEngine();
  const db = new SQL.Database();
  db.run(sql);
  return db;
}
const columns = (db, table) =>
  db.exec(`PRAGMA table_info(${table})`)[0].values.map(r => r[1]);

describe('schema', () => {
  test('creates every table the app writes to', async () => {
    const db = await open(create);
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0].values.flat();
    ['settings', 'printers', 'filaments', 'supplies', 'products',
     'quotes', 'quote_lines', 'quote_supplies', 'events'].forEach(t =>
      assert.ok(tables.includes(t), `missing table ${t}`));
  });

  test('enforces foreign keys and cascades quote lines', async () => {
    const db = await open(create);
    db.run("INSERT INTO quotes (id,no,date,status,vat,margin) VALUES ('q1','Q-1','2026-08-28','draft',21,40)");
    db.run("INSERT INTO quote_lines (quoteId,seq,name,qty,cost,price) VALUES ('q1',0,'Vase',1,5,9)");
    db.run("DELETE FROM quotes WHERE id='q1'");
    assert.equal(db.exec('SELECT COUNT(*) FROM quote_lines')[0].values[0][0], 0);
  });

  test('exposes a filament cost view', async () => {
    const db = await open(create);
    db.run("INSERT INTO filaments (id,brand,material,price,weight,stock,low) VALUES ('f1','Bambu','PETG',22.99,1000,850,200)");
    const row = db.exec('SELECT perGram, stockValue FROM v_filament_cost')[0].values[0];
    assert.ok(Math.abs(row[0] - 0.02299) < 1e-6);
    assert.ok(Math.abs(row[1] - 19.54) < 0.01);
  });
});

describe('migrations', () => {
  test('bring an old database up to date without touching its rows', async () => {
    const db = await open(legacySchema());
    db.run("INSERT INTO products (id,name,sku,margin,grams,hrs,mins,post,extras,listPrice) VALUES ('p1','Oude Vaas','V1',40,164,6,20,5,0.55,29.95)");
    db.run("INSERT INTO quotes (id,no,date,status,vat,margin) VALUES ('q1','Q-0009','2026-07-01','paid',21,40)");
    db.run("INSERT INTO quote_lines (quoteId,seq,name,qty,cost,price) VALUES ('q1',0,'Oude regel',3,5,9)");

    db.run(create);
    migrations.forEach(sql => { try { db.run(sql); } catch { /* already there */ } });

    assert.ok(columns(db, 'products').includes('setup'));
    assert.ok(columns(db, 'products').includes('rate'));
    assert.ok(columns(db, 'quote_lines').includes('productId'));
    assert.ok(columns(db, 'quotes').includes('lang'));

    const p = db.exec('SELECT name,sku,grams,listPrice FROM products')[0].values[0];
    assert.deepEqual(p, ['Oude Vaas', 'V1', 164, 29.95]);
    const l = db.exec('SELECT name,qty,price FROM quote_lines')[0].values[0];
    assert.deepEqual(l, ['Oude regel', 3, 9]);
  });

  test('are safe to run again on every open', async () => {
    const db = await open(create);
    const before = columns(db, 'products').length;
    for (let i = 0; i < 3; i++) {
      migrations.forEach(sql => { try { db.run(sql); } catch { /* expected */ } });
    }
    assert.equal(columns(db, 'products').length, before);
  });
});

describe('round trip', () => {
  test('everything the app holds survives export and reload', async () => {
    const h = await boot();
    const d = h.document;

    d.getElementById('f_brand').value = 'Bambu';
    d.getElementById('f_material').value = 'ASA';
    d.getElementById('f_colorName').value = 'Wit';
    d.getElementById('f_save').dispatchEvent(new h.window.Event('click'));
    await h.tick();

    const before = JSON.stringify({
      filaments: h.app().DB.filaments.length,
      printers: h.app().DB.printers.length,
      settings: h.app().DB.settings.wage
    });

    h.app().sync();
    h.app().load();

    const after = JSON.stringify({
      filaments: h.app().DB.filaments.length,
      printers: h.app().DB.printers.length,
      settings: h.app().DB.settings.wage
    });
    assert.equal(after, before);
    assert.ok(h.app().DB.filaments.some(f => f.material === 'ASA'));
  });

  test('the exported file is a real SQLite database', async () => {
    const h = await boot();
    const bytes = Buffer.from(h.app().bytes());
    assert.equal(bytes.subarray(0, 15).toString('latin1'), 'SQLite format 3');
    const SQL = await sqlEngine();
    const reopened = new SQL.Database(new Uint8Array(bytes));
    assert.ok(reopened.exec('SELECT COUNT(*) FROM filaments')[0].values[0][0] > 0);
  });

  test('a save actually reaches the file handle', async () => {
    const h = await boot();
    assert.ok(h.written.count > 0, 'nothing was written');
    assert.equal(h.written.bytes.subarray(0, 15).toString('latin1'), 'SQLite format 3');
  });
});
