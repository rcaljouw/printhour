<img src="app/assets/logo.svg" width="72" alt="">

# PrintHour

**3D printing cost, inventory and quoting — priced by the print hour, not by the piece.**

Most costing tools tell you the margin on a part. That is the wrong number.
Printer time is the scarce resource, so the question is what an hour of it
earns you. A large vase can look excellent per piece and be your worst product
per hour; a small accessory the other way round.

Runs in your browser, stores everything in a single SQLite file you choose the
location of. No account, no cloud, no telemetry.

```
Kabelclip        0.4 h   € 7,91/h   67% margin
Plantenpot       6.5 h   € 2,09/h   55% margin
Vaas Groot      18.0 h   € 1,25/h   45% margin
```

---

## What it does

**Costing** — filament, electricity, machine depreciation, your own time,
hardware and packaging, plus a failure allowance. Setup is charged once per
batch, post-processing per unit.

**Inventory** — spools with per-gram cost and stock in grams, printer profiles
with a derived hourly rate, hardware and packaging by the piece. Change a spool
price and every product reprices.

**Quotes** — multi-line, built from your products, with SKUs and a client
document that prints to PDF in Dutch or English, including local number and
date formats. Accepting a quote deducts the filament and parts it consumes,
and warns when the shelf cannot cover the order.

**Marketplace** — Etsy, Shopify, eBay, Amazon and direct sale. Fees are
editable and dated. VAT is handled properly, with a switch for the Dutch
small-business scheme, because a listing price is a consumer price and that
part was never yours. Compare all channels at once, work backwards from a
target profit, and check whether a month's volume actually fits your machines.

## Install

**On your own machine** — unzip, then:

```bash
chmod +x app/start.command   # once
./app/start.command          # double-clickable on macOS
```

Opens at `http://localhost:8777`. Use Chrome or Edge: Safari and Firefox lack
the File System Access API, so they fall back to browser-held storage.

The launcher picks the first free port from 8777 upward and prints which one
it used. Serving over `http://localhost` rather than `file://` is what lets
the app reconnect to your database automatically.

**On an Umbrel, via Portainer** — the quickest route, and no registry needed:
point Portainer at this repository with
[`deploy/portainer-stack.yml`](deploy/portainer-stack.yml) and it builds the
image on the machine itself, so the architecture always matches. The database
lives in a named Docker volume rather than a host path, because Umbrel runs
Portainer against a Docker daemon that is itself containerised — a bind mount
there points somewhere other than the folder you see over SSH. Note that
nothing sits in front of it: PrintHour holds client names and prices, so bind
it to localhost and reach it over Tailscale if your network is shared.

**On an Umbrel, as an app** — the manifests in [umbrel/](umbrel/) are a
blueprint, not a working install path: they expect a published image that does
not exist yet. Use the Portainer route above.

Once it runs, [docs/RUNNING.md](docs/RUNNING.md) covers updating, backups and
what to check when something breaks. The bundled server keeps the
database on the Umbrel instead of on the client, with a version token so a
second tab cannot silently overwrite the first. Build the image with
`docker build -f server/Dockerfile .` from the repository root.

## Your data

One SQLite file. Open it in [DB Browser for SQLite](https://sqlitebrowser.org),
query it from Python or Excel, back it up like any other document.

```sql
SELECT p.name,
       ROUND(p.listPrice, 2)                      AS price,
       ROUND(p.hrs + p.mins / 60.0, 1)            AS print_hours
FROM products p
ORDER BY print_hours DESC;
```

The app also has a read-only SQL console under Settings, and a JSON export as
a second backup. New columns are added automatically when an older database is
opened; existing rows are left alone.

## Development

```bash
npm install
npm test
./scripts/backup.sh          # pull a dated copy of a running instance
```

The suite boots the real `app/index.html` in jsdom against a real SQLite
engine and drives it through the DOM, so it tests the shipped file rather than
a copy of its logic. Every entry under "Fixed" in the [changelog](CHANGELOG.md)
has a test named after it.

The app is one HTML file: markup, CSS and an IIFE. That is deliberate for now —
it makes the thing trivially portable — but it is at the practical limit, and
splitting it into modules behind a build step is the next structural step.
Tests came first so that refactor has a safety net.

## Licence

MIT. Fee tables and VAT rules are provided in good faith and go out of date;
check them against the source before you rely on them for pricing or a return.

Uses [sql.js](https://sql.js.org) (MIT), SQLite compiled to WebAssembly.
