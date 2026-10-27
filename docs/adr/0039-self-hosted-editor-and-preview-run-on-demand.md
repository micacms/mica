# 39. The self-hosted editor and its preview can run on demand

**Status:** Accepted

## Context

The website never calls Mica ([1](0001-git-is-the-source-of-truth.md)), so the self-hosted editor and its preview container ([38](0038-self-hosted-live-preview.md)) serve only the editors while they edit. Both run at all times today. On the example site, measured on the local editor, the editor uses about 86 MB and the preview's `astro dev` 314 to 362 MB; at rest, both use almost no CPU. The self-hosted editor also fetches from the Git host every 60 seconds, and the preview restarts at each push that changes a file of the website, also when nobody edits.

A stop loses nothing: the drafts are files on the volume ([7](0007-self-hosted-mica-keeps-its-own-clone.md)), and a session is a sealed cookie ([4](0004-sealed-sessions-and-no-state-about-people.md)). The editor sends a request only when a person acts, and the gate closes the preview's reload connection when its ten-minute cookie ends. So a time without requests means that nobody edits.

## Decision

- The self-hosted editor and its preview can run on demand. A starter outside Mica starts their containers at the first request for the editor's or the preview's name, and stops them after a time without requests: a reverse proxy that does this, such as Sablier with Caddy or Traefik, or a platform that scales to zero.
- The documented setup puts both containers in one group. They start and stop together, so the start of the preview overlaps with the sign-in. A preview that runs at all times stays a choice, for a team that edits all day or a large site that starts slowly.
- Mica does not start or stop containers. That needs the Docker socket, a right that Mica must not hold ([10](0010-git-on-the-server-is-isolated.md)), and Mica does not start the preview ([38](0038-self-hosted-live-preview.md)). Mica has no idle timer of its own: the starter decides when to stop.
- Before it stops, Mica tries once more to push a publication that is committed but not pushed (`pending_push`), within its shutdown wait.
- After a start, the preview waits a short time at most for Mica's first sync, so that it starts once, with the newest templates.

## Consequences

- While nobody edits, the server keeps the memory of both containers free, most of it the preview's. The CPU saving at rest is small. mica.build names a saving only after a measurement of the real containers.
- The first request waits for the start: a few seconds for the editor, longer for the preview, which copies the website and installs from its cache. The form shows at once, and the page beside it when the dev server answers.
- A template change costs nothing while both sleep: the preview copies the clone's newest commit at its start. While they run, it follows each sync, as in [38](0038-self-hosted-live-preview.md).
- While Mica sleeps, it does not sync. It finds conflicts at the next start, as after a long outage of the Git host. When the last push fails too, the publication waits for the next start, and the website changes later.
- An uptime monitor on `/ready` keeps Mica awake. The guide says so, and the starter can leave out that path.
- A hosted offer can use the same design: one group for each site, which scales to zero.
- Change this decision when: a starter must know Mica's state, such as a pending push, to stop safely, or a cold start takes so long that editors wait.
