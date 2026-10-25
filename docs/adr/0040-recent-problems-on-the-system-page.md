# 40. The System page shows recent problems of Mica and of its preview

**Status:** Accepted

## Context

When something fails, an editor opens the System page and sends the report to the developer. The report has no history today, so the developer needs the server's log. The self-hosted Mica cannot read the preview container's output: it has no Docker socket ([10](0010-git-on-the-server-is-isolated.md)). So it only guesses the state of the preview from whether it answers: "starting" for five minutes, then "stopped" ([38](0038-self-hosted-live-preview.md)). A failed install and a slow start look the same.

Every admitted person is an editor and sees the System page; there are no roles ([3](0003-admission-by-provider-claims.md)). Mica's info lines name editors by their email address, and its log can name hosts and paths.

## Decision

- Mica keeps its last 100 log lines of the levels warning and error in memory, never on disk. The System page shows them with their time, and "Copy report" adds them. A restart empties them, so Mica keeps no state ([1](0001-git-is-the-source-of-truth.md)). Email addresses are hidden in them, and the secrets are taken out as in the log itself.
- The preview image answers `GET /status` on port 4380 inside the network: its state (`waiting`, `copying`, `installing`, `starting`, `running` or `failed`), since when, the commit of its copy, a short reason, and its last 50 lines of output, from its own steps, the install and `astro dev`. It takes out credentials in addresses and tokens such as `_authToken=` before it answers. The preview publishes no port, and the gate forwards only to `MICA_PREVIEW_UPSTREAM`.
- The self-hosted Mica asks that port on the server side, at the host of `MICA_PREVIEW_UPSTREAM`. It takes the preview's state from it: `running` with an answer of the dev server is live, `failed` is stopped, the others are starting, with the reason. The System page shows the lines. When the port does not answer, as with an image of one's own, Mica guesses as before.
- Mica treats the answer as untrusted text: the site's code runs in that container and can write anything into it, as it can into its own pages. Mica shows it as plain text, with a limit on its length, and only to signed-in editors.
- The local editor shows the last 50 lines of the `astro dev` that `--preview` started in the same place.

## Consequences

- A developer gets the recent problems with the report, without a shell on the server.
- An editor sees why the preview stopped, such as a failed install, and the state in the menu is exact for Mica's preview image.
- The status port is in the image contract of [30](0030-semver-covers-the-public-surface.md). An image of one's own can answer it, and does not have to.
- Warnings and errors stay readable for every editor. They must name no secret and no email address; a new log line must keep to that.
- Change this decision when: Mica gets roles, so that only some people see the System page, or the preview needs more than a state and its last lines.
