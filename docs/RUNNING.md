# Running PrintHour

How this project is actually deployed, written down so it does not have to be
rediscovered. If you are coming back to this after months away, read this file
first.

Two instances exist and they are **separate databases that never sync**:

| | Where | Database | Used for |
|---|---|---|---|
| Umbrel | `http://umbrel.local:3737` | named Docker volume `printhour-data` | the real administration |
| Mac | `./app/start.command` → `http://localhost:8777` | a `.sqlite` file you pick | trying things out |

Pick one as the record of truth and stick to it. Two half-maintained copies
are worse than one.

---

## Changing something

The repository is the source. Portainer follows it.

```bash
cd ~/Documents/printhour
# edit, then:
npm test                     # 57 tests, all green before you push
git commit -am "what changed"
git push
```

Then in Portainer: **Stacks → printhour → Pull and redeploy**.

Confirm it landed: the build stamp at the right of the app's database bar
should show the date you edited in `app/index.html`. If it does not, you are
looking at a cached page — Cmd + Shift + R.

The stamp is deliberate. It is the only way to answer "am I running the
version I think I am" without guessing, and that question came up more than
once while building this.

---

## Backups

The database is the one thing that cannot be regenerated.

```bash
./scripts/backup.sh                          # from the Umbrel
./scripts/backup.sh http://localhost:8777    # from the Mac instance
```

Writes a dated `.sqlite` into `./backups/`, keeps the last 30, and refuses to
save anything that is not a real SQLite file. It works over the app's HTTP
API, so it needs no SSH and no Docker — which matters, because the database on
the Umbrel is not reachable as an ordinary file (see below).

Worth putting in your calendar monthly. The app also writes a daily snapshot
inside its own volume, but that lives on the same machine and does not help if
the machine does.

**Restoring** is the reverse: `Settings → Restore from JSON` for the JSON
export, or replace the file and restart for a `.sqlite`.

---

## Why a named volume and not a folder

Umbrel runs Portainer against a Docker daemon that is **itself a container**
(`portainer_docker_1`, image `docker:27.2.0-dind`). A bind mount like
`/home/umbrel/printhour-data` is therefore resolved inside *that* container,
not on the machine you SSH into.

The symptom is confusing: you create and `chown` a folder on the host, the
container still cannot write, and `docker ps` from the host does not even show
your container because you are talking to the wrong daemon.

So the stack uses a named volume, and `server/Dockerfile` creates `/data` owned
by uid 1500 before declaring it a volume, so an empty volume inherits that
ownership. No manual `chown` anywhere.

To reach the file directly: **Portainer → Volumes → printhour-data → Browse**.
Or just use `scripts/backup.sh`.

---

## When something is wrong

**Start with the container logs** — Portainer → Containers → printhour → Logs.
A healthy start is exactly three lines:

```
[printhour] listening on 3737
[printhour] database: /data/printhour.sqlite
[printhour] data directory is writable
```

Missing the third line, or a `CANNOT WRITE TO /data` block instead, means the
volume ownership is wrong. That check exists because the failure used to be
invisible until the first save.

**The app says it cannot save.** Three different messages, three different
causes:

| Message | Means |
|---|---|
| Server niet bereikbaar | the request never arrived — container down, wrong address |
| Server weigert op te slaan (HTTP …) | the server answered and refused — the reason is in the message and the logs |
| Elders gewijzigd | another tab or browser wrote first — reload before continuing |

**404 in the browser.** An older server is still running against a folder that
moved. Close stray Terminal windows and start `app/start.command` again; it
picks the first free port from 8777 and prints which one.

**The startup dialog will not close, or a change does not show.** Almost always
a cached `index.html`. Cmd + Shift + R.

---

## What is not wired up

`umbrel/` holds the manifests for installing PrintHour from an Umbrel
Community App Store. That route needs a published Docker image on GHCR, which
does not exist yet, so **the folder is a blueprint, not a working install
path**. The Portainer route above is what runs.

Finishing it would mean: push a `v*` tag so `.github/workflows/docker.yml`
builds and publishes the image, make that package public, move `umbrel/` into
its own repository with the store manifest at the root, and add the three
gallery screenshots the manifest expects. Its only real advantage over
Portainer is that Umbrel's app proxy puts a login in front of the app.

Which brings up the one thing worth knowing about the current setup: **there is
no authentication**. Port 3737 is open to everything on the network, and
PrintHour holds client names and prices. On a shared network, bind it to
`127.0.0.1` in `deploy/portainer-stack.yml` and reach it over Tailscale.
