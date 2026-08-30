# Umbrel Community App Store manifests

**Not active.** These files describe how PrintHour would be installed from an
Umbrel Community App Store. That route needs a Docker image published to GHCR,
which does not exist yet, so `docker-compose.yml` points at an image nobody can
pull.

What actually runs is the Portainer stack in [`../deploy/`](../deploy/), which
builds the image on the machine itself. See
[`../docs/RUNNING.md`](../docs/RUNNING.md).

To finish this route:

1. `git tag v1.0.0 && git push --tags` — `.github/workflows/docker.yml` builds
   and publishes a multi-architecture image to GHCR.
2. Make that package public in the repository's Packages settings.
3. Copy the contents of this folder into its own repository, with
   `umbrel-app-store.yml` at the root. Umbrel requires the store manifest
   there, which is why it cannot stay a subfolder here.
4. Add `1.jpg`, `2.jpg` and `3.jpg` screenshots next to `umbrel-app.yml`, or
   drop the `gallery:` block.
5. Keep `version:` in `umbrel-app.yml` in step with the image tag. It is not
   the same number as the build stamp inside the app.

The one thing this route buys over Portainer: Umbrel's app proxy puts a login
in front of the app.
