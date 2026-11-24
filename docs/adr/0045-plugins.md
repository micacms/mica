# 45. Plugins: packages that the model names and the operator permits

**Status:** Accepted. The plugin contract is experimental: it is outside the semver surface of [30](0030-semver-covers-the-public-surface.md).

## Context

Sites have different needs: a media system of their own, a spell check, a translation service, a field of their own. Each such feature in the core makes the core larger for every site. Code of a plugin in the editor page would run with the editor's rights, Publish included.

## Decision

- A plugin is an npm package. The model names it: `plugins` in `defineSite` in `src/mica.ts`. Each item is plain data (name, package, options), and the manifest carries it. Mica never runs `src/mica.ts`.
- A plugin package has two entry points: one for the model, which returns that data, and one for the server, which has the hooks.
- The operator installs the package into the plugin folder of a custom image and permits it with `MICA_PLUGINS`. Mica loads a plugin only when the model names it and the operator permits it. The local editor loads a plugin from the project, with the same contract.
- A plugin declares, as static data, its name, the hosts that it calls, the environment variables that it reads and what it provides. Mica checks the declaration at start, and shows it on the System page and in the CLI.
- Content options are in the model. Deployment settings and secrets are in environment variables. An option never decides where a secret goes.
- A hook gets plain data and returns plain data, with files by reference. Mica collects the results of all plugins. No plugin changes the result of another.
- The hook types are: issues of a value, suggestions for a value, a media provider ([46](0046-media-values-and-providers.md)) and a field.
- Plugins advise, and Mica acts. A plugin never publishes, discards or syncs. A media provider does an editor's action on its own system, and the editor marks an action that takes effect outside Publish.
- No plugin code runs in the editor page. A plugin describes its interface as data, and Mica draws it from its own elements.
- A model that names a plugin that Mica has not loaded makes the parts that need it read-only, as in [17](0017-an-unknown-field-makes-its-collection-read-only.md).

## Consequences

- The Mica image has no package manager and refuses native modules. A site with plugins builds an image of its own.
- A plugin runs in Mica's process. Mica shows the declared hosts and variables, and does not enforce them. Install only a plugin that you trust.
- A plugin cannot give the editor a look of its own.
- The contract can change in a 1.x minor.
- Change this decision when: plugins of third parties have proved the contract (then it becomes a part of the semver surface), or operators need enforced limits (then a plugin runs in a separate process, which the plain-data hooks permit).
