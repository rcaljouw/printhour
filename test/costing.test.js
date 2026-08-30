import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, set, choose, click, text, money } from './helpers/app.js';

/** A workshop with one printer and one spool at known prices. */
async function workshop() {
  const h = await boot();
  const d = h.document;

  set(d, 'd_wage', 50);
  set(d, 'd_kwh', 0.25);
  set(d, 'd_waste', 3);
  set(d, 'd_fail', 8);
  await h.tick();

  d.getElementById('m_name').value = 'Bambu X2D';
  set(d, 'm_watts', 110);
  set(d, 'm_life', 4000);
  set(d, 'm_maint', 0);
  set(d, 'm_hours', 700);
  d.getElementById('m_override').value = '0.33';
  click(d, 'm_save');

  d.getElementById('f_brand').value = 'Bambu';
  d.getElementById('f_material').value = 'PETG';
  d.getElementById('f_colorName').value = 'Dennengroen';
  set(d, 'f_price', 22.99);
  set(d, 'f_weight', 1000);
  click(d, 'f_save');
  await h.tick();

  const printers = h.app().DB.printers;
  const spools = h.app().DB.filaments;
  return { ...h, printer: printers[printers.length - 1], spool: spools[spools.length - 1] };
}

/** The plant pot from the bug report: 164 g, 6h20, 5 min setup + 5 min post. */
function plantPot(h) {
  const d = h.document;
  choose(d, 'c_filament', h.spool.id);
  choose(d, 'c_printer', h.printer.id);
  d.getElementById('jobName').value = 'Japandi Plant Pot 86mm';
  set(d, 'c_qty', 1);
  set(d, 'c_fail', 2);
  set(d, 'c_grams', 164);
  set(d, 'c_waste', 3);
  set(d, 'c_hrs', 6);
  set(d, 'c_mins', 20);
  set(d, 'c_rate', 0.33);
  set(d, 'c_watts', 110);
  set(d, 'c_setup', 5);
  set(d, 'c_post', 5);
  set(d, 'c_wage', 50);
  set(d, 'c_extraHw', 0);
  set(d, 'c_pack', 0.55);
  set(d, 'c_ship', 0);
}

describe('calculator', () => {
  test('breaks a job into material, energy, machine, labour, extras and failure', async () => {
    const h = await workshop();
    plantPot(h);
    await h.tick();

    const p = h.app().lastCalc().parts;
    // 164 g + 3% purge at 22.99/kg
    assert.ok(Math.abs(p.material - 3.883) < 0.01, `material ${p.material}`);
    // 110 W for 6.333 h at 0.25/kWh
    assert.ok(Math.abs(p.energy - 0.174) < 0.01, `energy ${p.energy}`);
    // 6.333 h at 0.33/h
    assert.ok(Math.abs(p.machine - 2.09) < 0.01, `machine ${p.machine}`);
    // 5 min post + 5 min setup over a batch of one, at 50/h
    assert.ok(Math.abs(p.labour - 8.333) < 0.01, `labour ${p.labour}`);
    assert.equal(p.extras, 0.55);
    // failure allowance applies to material + energy + machine only
    assert.ok(Math.abs(p.failure - (p.material + p.energy + p.machine) * 0.02) < 0.001);
  });

  test('spreads setup across the batch but not post-processing', async () => {
    const h = await workshop();
    plantPot(h);
    await h.tick();
    const one = h.app().lastCalc().parts.labour;

    set(h.document, 'c_qty', 10);
    await h.tick();
    const ten = h.app().lastCalc().parts.labour;

    // post stays at 5 min/unit; setup drops from 5 min to 0.5 min/unit
    assert.ok(Math.abs(one - (5 / 60 + 5 / 60) * 50) < 0.01);
    assert.ok(Math.abs(ten - (5 / 60 + 5 / 600) * 50) < 0.01);
    assert.ok(ten < one);
  });
});

describe('product costing', () => {
  // Regression: products used to omit setup and ignore the calculator's
  // purge, failure and machine-rate overrides, so a saved product came out
  // €3.59 cheaper than the job it was saved from.
  test('a saved product costs exactly what the calculator said', async () => {
    const h = await workshop();
    plantPot(h);
    await h.tick();
    const fromCalc = money(text(h.document, 'c_unit'));

    click(h.document, 'c_toProduct');
    await h.tick();

    const product = h.app().DB.products[0];
    const fromProduct = h.app().productCost(product).total;
    assert.ok(Math.abs(fromCalc - fromProduct) < 0.01,
      `calculator ${fromCalc} vs product ${fromProduct}`);
  });

  test('carries the calculator overrides onto the product', async () => {
    const h = await workshop();
    plantPot(h);
    await h.tick();
    click(h.document, 'c_toProduct');
    await h.tick();

    const p = h.app().DB.products[0];
    assert.equal(p.waste, 3, 'purge override');
    assert.equal(p.fail, 2, 'failure override');
    assert.equal(p.setup, 5, 'setup minutes');
    assert.equal(p.rate, 0.33, 'machine rate override');
    assert.equal(p.watts, 110, 'power draw override');
  });

  test('falls back to the settings defaults when a product has no override', async () => {
    const h = await workshop();
    const bare = { filamentId: h.spool.id, printerId: h.printer.id,
      grams: 100, hrs: 1, mins: 0, post: 0, extras: 0, setup: 0, batch: 1,
      waste: null, fail: null, rate: null, watts: null };
    const c = h.app().productCost(bare);

    // settings: 3% purge, 8% failure, printer rate 0.33, 110 W
    assert.ok(Math.abs(c.material - 100 * 1.03 * 0.02299) < 0.01);
    assert.ok(Math.abs(c.machine - 0.33) < 0.01);
    assert.ok(Math.abs(c.failure - (c.material + c.energy + c.machine) * 0.08) < 0.001);
  });

  test('an unpriced product still yields a profit per print hour', async () => {
    const h = await workshop();
    plantPot(h);
    await h.tick();
    click(h.document, 'c_toProduct');
    await h.tick();

    const p = h.app().DB.products[0];
    const c = h.app().productCost(p);
    assert.ok(c.printH > 6 && c.printH < 7, `print hours ${c.printH}`);
    assert.ok(c.total > 0);
  });
});
