import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, set, click, text, money } from './helpers/app.js';

/** The plant pot on Etsy: €29.95 plus €4.95 shipping, €15.15 to make. */
async function listing() {
  const h = await boot();
  const d = h.document;
  click(d, d.getElementById('tabs').querySelector('[data-tab=market]'));
  set(d, 'k_cost', 15.15);
  set(d, 'k_price', 29.95);
  set(d, 'k_shipCharged', 4.95);
  set(d, 'k_shipReal', 4.95);
  set(d, 'k_vat', 21);
  set(d, 'k_volume', 20);
  set(d, 'k_hoursPer', 6.33);
  set(d, 'k_capacity', 200);
  await h.tick();
  return h;
}

const mode = (h, m) =>
  click(h.document, h.document.getElementById('k_vatmode').querySelector(`[data-mode=${m}]`));

describe('VAT', () => {
  // The listing price on a marketplace is a consumer price: the VAT in it was
  // never yours. Input VAT on filament and postage comes back, so costs are
  // taken net too.
  test('a VAT-registered seller keeps less than the gross margin suggests', async () => {
    const h = await listing();
    mode(h, 'none');
    await h.tick();
    const kor = money(text(h.document, 'k_profit'));

    mode(h, 'incl');
    await h.tick();
    const liable = money(text(h.document, 'k_profit'));

    assert.ok(liable < kor, 'VAT mode should reduce profit');
    // gross 34.90 -> net 28.84; cost 15.15 -> 12.52; ship 4.95 -> 4.09
    assert.ok(Math.abs(liable - 8.09) < 0.05, `profit ${liable}`);
    assert.ok(Math.abs(kor - 10.66) < 0.05, `KOR profit ${kor}`);
  });

  test('states the VAT actually owed on the sale', async () => {
    const h = await listing();
    mode(h, 'incl');
    await h.tick();
    // 6.06 charged, minus 2.63 + 0.86 reclaimed
    assert.match(text(h.document, 'k_vatHint'), /2,5[0-9]/);
  });

  test('under KOR nothing is deducted and nothing reclaimed', async () => {
    const h = await listing();
    mode(h, 'none');
    await h.tick();
    assert.match(text(h.document, 'k_vatHint'), /KOR/);
  });
});

describe('reverse pricing', () => {
  test('the break-even price really breaks even', async () => {
    const h = await listing();
    mode(h, 'incl');
    await h.tick();

    const rows = [...h.document.querySelectorAll('#k_reverse .l')];
    const breakEven = money(rows[0].querySelector('.price').textContent);
    set(h.document, 'k_price', breakEven.toFixed(2));
    await h.tick();

    const profit = money(text(h.document, 'k_profit'));
    assert.ok(Math.abs(profit) < 0.05, `break-even left ${profit}`);
  });

  test('the target price delivers the target profit', async () => {
    const h = await listing();
    mode(h, 'incl');
    set(h.document, 'k_target', 12);
    await h.tick();

    const rows = [...h.document.querySelectorAll('#k_reverse .l')];
    const needed = money(rows[1].querySelector('.price').textContent);
    set(h.document, 'k_price', needed.toFixed(2));
    await h.tick();

    assert.ok(Math.abs(money(text(h.document, 'k_profit')) - 12) < 0.05);
  });
});

describe('channel comparison', () => {
  test('ranks every channel on the same price and cost', async () => {
    const h = await listing();
    const bars = [...h.document.querySelectorAll('#k_compare .b')];
    assert.ok(bars.length >= 5, `only ${bars.length} channels`);

    const values = bars.map(b => money(b.querySelector('.n').textContent));
    const sorted = [...values].sort((a, b) => b - a);
    assert.deepEqual(values, sorted, 'not sorted by profit');

    const names = bars.map(b => b.querySelector('.lab').textContent);
    assert.match(names[0], /Market stall|direct/, 'fee-free channel should lead');
  });

  // Comparison writes each channel's fees into the live fields to reuse the
  // same maths; it must put the chosen channel's fees back afterwards.
  test('leaves the chosen channel untouched', async () => {
    const h = await listing();
    const d = h.document;
    const before = ['k_listing', 'k_trans', 'k_payPct', 'k_payFix', 'k_ads'].map(i => d.getElementById(i).value);
    set(d, 'k_price', 31.5);
    await h.tick();
    const after = ['k_listing', 'k_trans', 'k_payPct', 'k_payFix', 'k_ads'].map(i => d.getElementById(i).value);
    assert.deepEqual(after, before);
  });
});

describe('monthly scenario', () => {
  test('scales profit with volume', async () => {
    const h = await listing();
    const per = money(text(h.document, 'k_profit'));
    const month = [...h.document.querySelectorAll('#k_month .l')].pop();
    assert.ok(Math.abs(money(month.textContent) - per * 20) < 0.5);
  });

  test('flags when the printers cannot take the volume', async () => {
    const h = await listing();
    assert.doesNotMatch(text(h.document, 'k_loadNote'), /past niet/);

    set(h.document, 'k_volume', 40);   // 40 × 6.33 h against 200 h
    await h.tick();
    assert.match(text(h.document, 'k_loadNote'), /past niet/);
    assert.match(text(h.document, 'k_loadNote'), /53/);
  });

  test('reports profit per print hour while there is capacity left', async () => {
    const h = await listing();
    assert.match(text(h.document, 'k_loadNote'), /per printeruur/);
  });
});
