# Mica CMS Technical Architecture

> Superseded in part by [git-workspace-plan.md](git-workspace-plan.md) (0.5.0): the
> self-hosted Mica keeps a Git clone, and Mica keeps no database.

Status: target architecture and incremental implementation guide  
Last updated: 19 August 2026

## 1. Purpose

This document defines the architecture of the open-source Mica CMS product, with emphasis on the two modes that will be built first:

1. **Local**: a completely authentication-free, single-site editor for local development.
2. **Self-hosted**: the same single-site editor protected by an external OpenID Connect provider.

Mica Cloud is intentionally described only at a high level. It is a later, private product built around stable releases of the open-source single-site runtime.

The primary goal is to make the open-source product small, understandable, secure, and useful before building a multi-site or multi-tenant platform.

## 2. Core decisions

### 2.1 One runtime manages one site

The open-source Mica runtime always manages exactly one site:

```text
one Mica process
  └── one SiteConfig
      ├── one content model
      ├── one editor
      └── one or two repository connections
```

There is no tenant selection, site selection, tenant membership, site membership, invitation system, or multi-site administration in the open-source runtime.

Running several self-hosted sites means running several Mica instances. This is an explicit product and operational boundary, not an artificial feature limit inside a shared multi-tenant server.

### 2.2 Local means no authentication at all

Local mode does not simulate a user. It does not display a user name, avatar, login state, logout action, account menu, or messages such as “Hello Developer.” Authentication and user concepts are absent from the local UI.

More strongly, the local package distribution must not install or bundle OIDC implementation code:

```text
npx @micacms/editor
  ├── installs the local editor runtime
  ├── binds to loopback
  ├── opens one configured site
  └── has no dependency on @micacms/auth-oidc
```

This is a package-boundary requirement, not merely a runtime feature flag.

### 2.3 Self-hosted adds external OIDC around the editor

Self-hosted Mica uses the identity system the operator already has, for example Google Workspace, Microsoft Entra, Keycloak, Authentik, ZITADEL, or another standards-compliant OIDC provider.

Mica does not implement passwords, MFA, passkeys, credential recovery, or an identity database.

### 2.4 Autosave stages content; Publish changes Git

Editing and autosave update a Mica draft workspace without creating commits or pushing a branch. The editor shows the accumulated changes and exposes an explicit **Publish** action. Publish validates the complete draft and writes one Git commit containing the accumulated content changes.

This separates editorial save frequency from Git history and SSG deployment frequency.

### 2.5 Multi-site and multi-tenancy are deferred to private Cloud software

Tenant administration, site portfolios, memberships, roles, billing, invitations, centralized repository onboarding, and managed operations are not part of the initial open-source runtime.

They may later be offered as:

- the hosted Mica Cloud service,
- a commercially licensed private deployment for an agency or organization,
- or a setup and operations service delivered by Mica.

The Cloud software does not need to be FOSS for an agency to receive its operational benefits.

### 2.6 Cloud depends on OSS, never the reverse

```text
PUBLIC / FOSS                         PRIVATE / COMMERCIAL

micacms/mica  ─────────────────────▶  micacms/cloud
released packages and images          control plane and managed operations
```

The public repository must never import private Cloud code. Cloud consumes published Mica packages or Docker images. There are no shared private folders, Git submodules, or local path dependencies between the repositories in release builds.

## 3. Product scope

### 3.1 Open-source scope

The public repository contains a complete single-site CMS:

- content model and validation,
- Astro integration,
- the editor UI,
- a local editor runtime,
- a self-hosted OIDC wrapper,
- GitHub and GitLab connectors,
- autosave, recent changes, content staging, and explicit publishing,
- single-repository and split UI/content-repository support,
- Docker packaging,
- documentation, examples, and end-to-end tests.

The open-source edition is not a demo or crippled Cloud client. It is a complete product for one site per runtime.

### 3.2 Deferred scope

The following are explicitly deferred until the single-site product is mature:

- tenant and organization models,
- multi-site dashboards,
- invitations and membership lifecycle,
- per-tenant and per-site roles,
- billing and quotas,
- centralized secrets and repository installations,
- fleet provisioning, monitoring, upgrades, and backups,
- cross-site search or content reuse.

## 4. Current repository as the baseline

The architecture starts from the current pnpm monorepo instead of replacing it with a speculative package layout:

```text
mica/
├── demo/
│   └── compose.yml
├── docs/
│   ├── architecture.md
│   ├── content-model.md
│   ├── decisions.md
│   ├── getting-started.md
│   └── self-hosting.md
├── e2e/
│   ├── compose.yml
│   └── keycloak-realm.json
├── packages/
│   ├── astro/
│   ├── connectors/
│   ├── editor/
│   └── model/
├── sites/
│   ├── micacms/
│   └── muster-consulting/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── scripts/version.mjs
└── vercel.json
```

Generated `dist/` folders and local `node_modules/` trees are not architecture components.

### 4.1 Current responsibilities and target moves

The current folders mix reusable libraries, browser UI, server runtime, provider integrations, and runnable products. The target structure should make these categories visible rather than preserve package names for their own sake.

| Current location                         | Target location              | Responsibility                                                                                                                                                     |
| ---------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/model`                         | `packages/core`              | Framework-independent content domain, schemas, validation, serialization, draft/change-set types, capability types, and repository port contracts                  |
| `packages/astro`                         | `packages/astro`             | Astro-specific integration built on `@micacms/core`                                                                                                                |
| editor browser code in `packages/editor` | `packages/editor-ui`         | Identity-neutral editor SPA and reusable editor UI only                                                                                                            |
| server code in `packages/editor`         | `packages/runtime`           | Single-site HTTP/API runtime, content application services, staging/publish orchestration, sessions interface, capability enforcement, and connector orchestration |
| local entry point in `packages/editor`   | `apps/local-editor`          | Published executable package `@micacms/editor`; composes the runtime, editor UI, and local connector without authentication                                        |
| contracts in `packages/connectors`       | `packages/core`              | Provider-neutral `RepositoryConnector` port and shared repository value types                                                                                      |
| GitHub code in `packages/connectors`     | `packages/connectors/github` | `@micacms/connector-github`, including GitHub-specific API integration                                                                                             |
| GitLab code in `packages/connectors`     | `packages/connectors/gitlab` | `@micacms/connector-gitlab`, including GitLab-specific API integration                                                                                             |
| local filesystem/Git behavior            | `packages/connectors/local`  | `@micacms/connector-local`, used by `npx @micacms/editor` without hosted-provider SDKs                                                                             |
| OIDC support                             | `packages/auth/oidc`         | `@micacms/auth-oidc`, a server-only OIDC gate and session integration                                                                                              |
| self-hosted composition                  | `apps/self-hosted`           | `@micacms/self-hosted` and the Docker entry point                                                                                                                  |

`model` becomes `core` because it is no longer merely a content-model DSL: it defines the stable, framework-independent language shared by Astro, the editor UI, the runtime, and infrastructure adapters. It must remain free of Node HTTP frameworks, browser frameworks, OIDC libraries, and Git-provider SDKs.

`apps/` contains runnable products and distribution entry points. `packages/` contains reusable libraries and provider adapters. This distinction makes it obvious which projects are composed and which are launched.

## 5. Target public repository and package graph

### 5.1 Target folder structure

```text
mica/
├── apps/
│   ├── local-editor/              package: @micacms/editor
│   └── self-hosted/               package: @micacms/self-hosted
├── packages/
│   ├── core/                      package: @micacms/core
│   ├── astro/                     package: @micacms/astro
│   ├── editor-ui/                 package: @micacms/editor-ui
│   ├── runtime/                   package: @micacms/runtime
│   ├── auth/
│   │   └── oidc/                  package: @micacms/auth-oidc
│   └── connectors/
│       ├── local/                 package: @micacms/connector-local
│       ├── github/                package: @micacms/connector-github
│       └── gitlab/                package: @micacms/connector-gitlab
├── examples/
│   ├── single-repository/
│   └── split-content-repository/
├── deploy/
│   ├── self-hosted/
│   └── demo-identity/
├── tests/
│   └── e2e/
├── docs/
├── common/config/rush/            after the Rush migration
└── rush.json                      after the Rush migration
```

Nested `auth/` and `connectors/` directories group infrastructure adapters without collapsing them into one installable package. Each leaf is an independent Rush project and npm package.

### 5.2 Package graph

```text
@micacms/self-hosted
  ├── depends on @micacms/runtime
  ├── depends on @micacms/editor-ui
  ├── depends on @micacms/auth-oidc
  ├── depends on @micacms/connector-github
  └── depends on @micacms/connector-gitlab

@micacms/editor
  ├── depends on @micacms/runtime
  ├── depends on @micacms/editor-ui
  └── depends on @micacms/connector-local

@micacms/runtime
  └── depends on @micacms/core

@micacms/editor-ui
  └── depends on @micacms/core

@micacms/astro
  └── depends on @micacms/core

all auth and connector adapters
  └── implement ports from @micacms/core

local command:
  npx @micacms/editor

self-hosted distribution:
  @micacms/self-hosted / Docker image
```

The dependency rules are:

1. `@micacms/core` depends on no UI framework, HTTP framework, authentication implementation, database driver, or provider SDK.
2. `@micacms/editor-ui` and `@micacms/runtime` are authentication-neutral.
3. `@micacms/editor` is the local composition root and depends only on the local connector; it must not pull OIDC, GitHub, or GitLab packages.
4. `@micacms/auth-oidc` is server-only and must not enter the editor browser bundle.
5. Provider packages depend inward on `@micacms/core` ports. Core never imports an adapter.
6. `@micacms/self-hosted` is the composition root that selects OIDC and hosted Git-provider adapters.
7. Cloud may depend on any published OSS package. No OSS package may depend on Cloud.

This split is intentionally explicit. It protects the local distribution, makes provider dependencies visible, and allows self-hosted and future Cloud products to compose the same runtime without forking it.

## 6. Local mode

### 6.1 User experience

The expected entry point is:

```bash
npx @micacms/editor
```

Local mode opens the configured site directly. The editor UI contains no authentication or identity chrome:

- no login screen,
- no user name or synthetic local user,
- no avatar,
- no account or profile menu,
- no logout button,
- no authentication status,
- no invitation or role UI,
- no empty placeholder reserved for future account controls.

The correct local header is the editor header, not an application account shell.

### 6.2 Distribution requirements

`@micacms/editor` must have no direct, optional, peer, or transitive dependency on the OIDC implementation package. Using an optional dependency would still cause package managers to fetch authentication code and therefore does not satisfy this requirement.

The local browser bundle must not contain:

- OIDC client code,
- login callback routes,
- token parsing or refresh logic,
- provider-specific assets or strings,
- user profile stores,
- Cloud membership or role code.

The local server may use an auth-neutral access policy that simply allows all editor actions. This is not an identity simulation and does not create a local `User` object.

```ts
createLocalEditor({
  site: siteConfig,
  access: allowAll(),
  repository,
});
```

`allowAll()` is a small authorization policy, not authentication code. Its purpose is to keep action checks consistent without introducing users into local mode.

### 6.3 Network safety

Because local mode has no authentication, it must be safe by construction:

- bind to `127.0.0.1` and/or `::1` by default,
- fail to start if an external bind address is requested,
- do not allow proxy headers to silently turn a loopback deployment into a remote one,
- never expose Git credentials or provider tokens to the browser,
- show a clear error directing remote users to the self-hosted distribution.

There should be no override such as `--allow-unauthenticated-public`. Remote access belongs to self-hosted mode.

### 6.4 Local acceptance tests

CI should enforce the product boundary:

1. Install `@micacms/editor` in a clean temporary project and inspect the resolved dependency graph; no auth package may be present.
2. Build the browser application and verify that known OIDC modules and auth routes are absent.
3. Run the editor and verify that no user- or authentication-related UI is rendered.
4. Verify successful loopback access.
5. Verify that binding to a non-loopback address fails.

These tests prevent authentication code from leaking back into the local package during later Cloud work.

## 7. Self-hosted mode

### 7.1 Intended user

Self-hosted Mica is designed for an organization that wants to operate one site and let existing employees edit it using their existing identity provider.

```text
Google Workspace ─┐
Microsoft Entra  ──┼── OIDC ──▶ self-hosted Mica ──▶ one site
Authentik        ──┤
Keycloak         ──┤
ZITADEL          ──┘
```

The organization does not need to install a separate identity platform if Google Workspace, Microsoft Entra, or another suitable OIDC provider is already available.

### 7.2 Composition

The self-hosted entry point wraps the auth-free editor runtime:

```ts
createSelfHostedMica({
  site: siteConfig,
  auth: oidc(oidcConfig),
  access: authenticatedEditors(),
  repository,
  secrets,
});
```

`packages/auth/oidc` is a server-only adapter. It owns:

- login and callback endpoints,
- authorization code flow with PKCE,
- session creation and termination,
- issuer, signature, audience, expiry, `state`, and `nonce` validation,
- extraction of the stable external identity,
- optional admission checks such as Workspace domain, Entra tenant, group, or explicit allowlist.

`apps/self-hosted` uses this adapter before forwarding a request into `@micacms/runtime`. The runtime receives only an auth-neutral `AccessContext` defined by `@micacms/core`; it does not know whether that context came from Google, Entra, Keycloak, or another provider. `@micacms/editor-ui` receives no provider tokens and does not import the OIDC adapter.

### 7.3 Initial authorization model

The first self-hosted version does not need user administration or a role database.

The simplest policy is:

```text
not authenticated
  └── no access

authenticated and admitted
  └── all editor capabilities for this site
```

Site infrastructure settings and repository credentials should remain operator configuration rather than becoming an in-editor administrator role in the first release.

If finer permissions become necessary later, the server may consume a small set of capabilities such as:

```text
content:read
content:write
repository:publish
site:configure
```

The open-source runtime still does not need to store users or roles. A self-hosted adapter can derive capabilities from configured OIDC claims. A future Cloud control plane can derive the same capabilities from its private membership model.

### 7.4 Self-hosted UI boundary

Authentication UI belongs to the self-hosted shell, not the editor package.

Before authentication, the wrapper may show a minimal sign-in page. After authentication, it mounts the same editor UI used locally. If a logout action or current identity is shown, that chrome is supplied by the self-hosted shell outside the editor bundle.

Therefore:

- local Mica renders only the editor,
- self-hosted Mica may render `self-hosted shell + editor`,
- future Cloud may render `Cloud shell + editor`.

The core editor itself remains identity-neutral in all three environments.

### 7.5 Configuration

A minimal deployment configuration is:

```env
MICA_PUBLIC_URL=https://cms.example.com
MICA_OIDC_ISSUER=https://id.example.com
MICA_OIDC_CLIENT_ID=mica
MICA_OIDC_CLIENT_SECRET=...
```

Google Workspace and Microsoft Entra presets may provide a simpler setup experience. They must configure the generic OIDC implementation rather than introduce separate authentication stacks.

Provider restrictions determine who may enter the single site. Email addresses are mutable and must not be used as stable identity keys. Where identities need to be referenced, use at least `(issuer, subject)`.

### 7.6 Self-hosted security requirements

- Use the Authorization Code Flow with PKCE.
- Validate issuer, signature, audience, expiry, `state`, `nonce`, and required claims server-side.
- Store browser sessions in secure, `HttpOnly`, appropriately `SameSite` cookies.
- Do not persist tokens in browser Local Storage.
- Configure redirect URIs and the public base URL explicitly.
- Protect login, callback, and state-changing API routes against CSRF, replay, and session fixation.
- Request minimal scopes.
- Store provider tokens only when a specific server-side use case requires them.
- Keep repository credentials and OIDC secrets on the server.
- Support explicit session revocation and short enough session lifetimes for access removal to take effect.

## 8. Single-site runtime model

The runtime has one explicit `SiteContext` even though only one exists per process:

```ts
interface SiteContext {
  id: string;
  model: ContentModel;
  contentRepository: RepositoryConnection;
  uiRepository?: RepositoryConnection;
}
```

The explicit context improves testability and avoids global state. It is not a hidden multi-site implementation and does not require tenant or membership tables.

The runtime may keep small operational state for sessions, locks, cached repository metadata, and pending draft writes. Git remains the source of truth for published content; the draft store is the source of truth for explicitly saved but unpublished changes.

## 9. Repository topology

Repository topology is independent of multi-site support. A single site may use one or two repositories.

### 9.1 Combined UI and content repository

```text
site-repo/
├── src/                  UI
├── public/
├── content/              Mica content
├── astro.config.mjs
└── package.json
```

This remains the default. The current `sites/*` projects move to named examples under `examples/`.

### 9.2 Separate UI and content repositories

```text
site-ui/                          site-content/
├── src/                          ├── collections/
├── public/                       ├── singletons/
├── astro.config.mjs              └── media/
└── package.json
```

The single `SiteContext` may reference both connections. The Astro package resolves content reproducibly from a concrete revision during development or build.

Split repositories are useful for separating design/deployment permissions from editorial content history. They do not introduce a second site or tenant.

## 10. Content staging and publishing

### 10.1 User model

Field edits and autosave must not create Git commits. Instead, they update a site-level draft workspace:

```text
edit field
  ▼
autosave draft
  ▼
Recent changes
  ├── modified documents
  ├── created/deleted documents
  ├── changed media
  ├── validation state
  └── discard actions
        ▼
      Publish
        ▼
one commit + one push/ref update
        ▼
production SSG rebuild
```

The editor should distinguish clearly between:

- **Saved**: the change is durable in Mica's draft workspace.
- **Published**: the change has been committed and pushed to the configured repository branch.

“Saved” must never imply that a change is in Git or deployed.

The first version has one shared pending change set per site. It is not a personal draft per user and does not introduce workflows, approvals, scheduled publishing, or multiple release queues.

### 10.2 Draft and publish model

The core model needs provider-neutral types such as:

```ts
interface DraftChangeSet {
  baseRevision: Revision;
  changes: ContentChange[];
  validation: ValidationResult;
  updatedAt: string;
}

type ContentChange =
  | { kind: "create"; path: string; content: Uint8Array }
  | { kind: "update"; path: string; content: Uint8Array }
  | { kind: "delete"; path: string };

interface PublishRequest {
  expectedBaseRevision: Revision;
  changes: ContentChange[];
  commitMessage: string;
}

interface PublishResult {
  commitRevision: Revision;
  remoteRevision?: Revision;
  state: "published" | "committed-pending-push";
}
```

These contracts, plus a small `DraftStore` port, belong in `@micacms/core`. The orchestration belongs in a `ContentStagingService` inside `@micacms/runtime`. Storage and Git operations remain adapters selected by the runnable app.

The first implementations do not require another published package:

- `apps/local-editor/src/staging` provides a working-tree-backed `DraftStore`.
- `apps/self-hosted/src/staging` provides a persistent filesystem/SQLite-backed `DraftStore`.

An implementation should be extracted into `packages/staging/*` only when a second runnable product genuinely reuses it.

The draft must remember the repository revision from which editing began. Publish uses this revision for optimistic concurrency and must never overwrite a branch that advanced unexpectedly.

### 10.3 Local implementation

In local mode, the checked-out working tree is the durable draft workspace:

```text
autosave
  └── write Mica-managed content files to the working tree

Recent changes
  └── inspect Git status/diff for Mica-managed paths

Publish
  ├── validate the complete content set
  ├── verify that HEAD still matches the expected base revision
  ├── stage only the reviewed Mica-managed paths
  ├── create one commit
  └── push the configured upstream branch
```

Mica must not run `git add -A` or commit unrelated developer changes. The publish operation receives an explicit path set from the draft/change model and limits Git operations to configured content and media roots.

Local Git authentication remains the developer's responsibility. Mica uses the repository's configured remote, SSH agent, credential helper, and upstream branch. It does not collect Git credentials in the editor UI.

A Git commit and a remote push are not one atomic operation. If the commit succeeds but push fails, Mica must retain and display the state `committed-pending-push`. Retrying Publish must retry the push instead of creating a duplicate commit.

If no upstream is configured, the branch has diverged, authentication fails, or the remote rejects the push, the UI reports the actionable Git error without discarding the saved draft or local commit.

### 10.4 Self-hosted implementation

Self-hosted Mica cannot use the remote repository itself as the draft workspace, because writing through a repository file API would already create commits. Autosaved content is therefore stored outside Git in persistent Mica-controlled storage:

```text
browser autosave
  ▼
@micacms/runtime
  ▼
persistent DraftStore
  ├── base repository revision
  ├── changed documents
  ├── deletions
  ├── media blobs
  └── validation state
        ▼ Publish
RepositoryConnector.publishChangeSet(...)
        ▼
one remote commit and branch update
```

The initial `DraftStore` may use a persistent filesystem workspace or SQLite plus a media directory. It must survive process restarts and be included in self-hosted backup guidance. Unpublished changes are not protected by Git history and the UI must communicate that distinction.

After successful publication, the runtime advances the base revision and clears only the changes included in that publication. It must not clear a newer autosave that arrived while publishing.

### 10.5 Connector publication contract

The repository port should expose one batch operation rather than a per-file save API:

```ts
interface RepositoryConnector {
  getRevision(ref: RepositoryRef): Promise<Revision>;
  read(ref: RepositoryRef, revision: Revision): Promise<RepositorySnapshot>;
  publishChangeSet(request: PublishRequest): Promise<PublishResult>;
}
```

GitHub can implement this using Git blobs, a tree based on the expected base tree, a commit object, and a non-forced reference update. GitLab's Commits API accepts multiple file actions in one commit. These provider capabilities allow Mica to publish a complete change set as one commit rather than one commit per file; see the official [GitHub Git database documentation](https://docs.github.com/en/rest/git) and [GitLab Commits API](https://docs.gitlab.com/api/commits/).

Connectors must use compare-and-set semantics against the expected branch revision where the provider allows it. They must never force-update the configured production branch.

### 10.6 Validation and conflicts

Publish is allowed only when the entire staged result is valid:

- all changed documents pass field and schema validation,
- cross-document references resolve,
- deletes do not leave invalid references,
- generated paths are unique,
- media constraints pass,
- repository paths stay inside the configured content/media roots.

Immediately before publishing, Mica compares the current branch revision with `baseRevision`:

```text
current revision == base revision
  └── publish

current revision != base revision
  └── conflict; do not publish
```

The first implementation should block and ask the editor to refresh/reconcile instead of attempting an automatic merge. Silent last-write-wins behavior and forced pushes are prohibited.

Concurrent autosaves also use optimistic revision checks at the document level so that one browser session cannot silently overwrite a newer draft from another session.

### 10.7 Publish state machine

The runtime should model publication explicitly:

```text
clean
  └── draft
       ├── invalid
       ├── conflict
       └── publishing
            ├── published ──▶ clean
            └── committed-pending-push
                    ├── retry ──▶ published
                    └── error remains visible
```

This state machine prevents ambiguous UI messages and duplicate commits. Production rebuilds are triggered by the successful remote branch update, not by field autosaves and not merely by creating a local commit.

### 10.8 Deliberate non-goals

The initial staging feature does not include:

- approval workflows,
- per-user private drafts,
- scheduled publishing,
- named releases,
- multiple parallel change sets,
- automatic rebasing or merging,
- preview deployments for every autosave.

Those features can be considered after the shared single-site staging workflow is reliable.

## 11. GitHub and GitLab connectors

GitHub and GitLab support remains part of the open-source product. Without repository connectors, a self-hosted Git-based CMS would not be complete.

The provider-neutral `RepositoryConnector` port lives in `@micacms/core`. It defines capabilities such as:

- resolving repositories and branches,
- reading and listing files,
- publishing a batch change set as one commit against an expected base revision,
- optionally creating branches and pull/merge requests,
- detecting revisions and write conflicts,
- normalizing relevant webhook events.

Provider implementations live in separate leaf packages:

```text
packages/connectors/
├── local/        @micacms/connector-local
├── github/       @micacms/connector-github
└── gitlab/       @micacms/connector-gitlab
```

The local connector works against the checked-out filesystem and local Git repository. It is the only connector installed by `@micacms/editor`.

GitHub and GitLab remain separate because their SDKs, authentication models, webhook payloads, and release risks differ. Keeping them out of a combined connector package also prevents `npx @micacms/editor` from downloading hosted-provider code it does not use.

Provider-specific types must not escape the adapter package. The runtime operates only on `@micacms/core` repository types and capabilities.

Self-hosted operators provide their own GitHub App, GitLab application, deploy key, or token. Future Cloud software may automate app installation and secret management while continuing to use the same OSS connectors.

## 12. Secrets

The local editor may use local Git credentials without exposing them to the browser.

Self-hosted Mica should support simple server-side secret sources:

- environment variables,
- Docker Secrets,
- mounted secret files.

Repository configuration stores secret references, not plaintext secrets in browser-visible configuration. Managed secret stores such as OpenBao, Vault, or a cloud KMS are later Cloud concerns unless there is concrete self-hosted demand.

## 13. Repository folder migration

The folder reorganization should be mechanical and reviewable after the internal boundaries are established:

| Current path                                  | Target path                                                          |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `packages/model`                              | `packages/core`                                                      |
| browser portion of `packages/editor`          | `packages/editor-ui`                                                 |
| server portion of `packages/editor`           | `packages/runtime`                                                   |
| local executable portion of `packages/editor` | `apps/local-editor`                                                  |
| GitHub portion of `packages/connectors`       | `packages/connectors/github`                                         |
| GitLab portion of `packages/connectors`       | `packages/connectors/gitlab`                                         |
| local repository behavior                     | `packages/connectors/local`                                          |
| new OIDC implementation                       | `packages/auth/oidc`                                                 |
| authenticated/Docker composition              | `apps/self-hosted`                                                   |
| `sites/micacms`                               | `examples/single-repository` or a named dogfooding example           |
| `sites/muster-consulting`                     | `examples/split-content-repository` or a named business-site example |
| `demo`                                        | `deploy/demo-identity`                                               |
| root self-hosting Compose files               | `deploy/self-hosted`                                                 |
| `e2e`                                         | `tests/e2e`                                                          |

Folder responsibilities then become unambiguous:

- `apps/` contains runnable and deployable composition roots.
- `packages/` contains reusable code and leaf infrastructure adapters.
- `examples/` contains sites users can inspect, run, or copy.
- `deploy/` contains Docker, Compose, and demonstration deployment assets.
- `tests/e2e/` contains cross-package system tests; Keycloak remains a test fixture, not a product dependency.
- `docs/` prioritizes local setup, self-hosting, repository connections, recovery, and architectural decisions.

The move should preserve history where practical and avoid mixing behavior changes with mass path changes in one pull request.

## 14. Mica Cloud — later, private, and intentionally high-level

Cloud work begins only after the open-source single-site runtime has a stable content model, editor, repository contract, self-hosted OIDC path, and release process.

The likely architecture is a private control plane managing many isolated single-site runtimes:

```text
Mica Cloud control plane
├── tenants and memberships
├── multi-site administration
├── managed IAM
├── repository onboarding
├── secrets
├── billing and quotas
├── provisioning and upgrades
└── one isolated Mica runtime per site
```

The same private platform could be:

- operated centrally as Mica Cloud,
- deployed for an agency under a commercial agreement,
- or installed and maintained as a professional service.

An agency deployment can therefore provide multi-site administration, centralized identity, roles, and managed operations without requiring those components to be open source.

The initial Cloud implementation should favor one runtime per site. This provides a strong isolation boundary and avoids adding tenant scoping to every editor query, cache, repository operation, and secret lookup. Shared multi-tenant runtimes should only be considered later if measured infrastructure costs justify the additional security complexity.

Cloud roles and memberships remain private control-plane concepts. They may be translated into short-lived, site-specific capabilities consumed by the single-site runtime. The runtime should not import the Cloud role model.

## 15. Rush, pnpm, changelogs, and releases

The public monorepo should migrate to **Rush with pnpm as its package manager**. Rush does not replace pnpm; it coordinates the project graph, installation policies, Change Files, versioning, changelogs, and publishing.

The Rush migration is independent of the authentication refactor and should be performed as a separate, reviewable change.

### 15.1 Version strategy

Initially use one lockstep Mica version for all published OSS packages and the self-hosted image:

```text
@micacms/core
@micacms/astro
@micacms/editor
@micacms/editor-ui
@micacms/runtime
@micacms/connector-local
@micacms/connector-github
@micacms/connector-gitlab
@micacms/auth-oidc
@micacms/self-hosted
Mica Docker image
                         ──▶ Mica X.Y.Z
```

This keeps compatibility, documentation, support, and later Cloud upgrades simple. Projects under `examples/`, `deploy/`, and `tests/` are not published.

### 15.2 Change and release flow

```text
feature PR
  ├── code and tests
  └── rush change
        ▼
CI
  ├── rush install
  ├── rush change --verify
  ├── build and test
  ├── local package-boundary tests
  ├── self-hosted OIDC E2E tests
  └── package dry run
        ▼
release PR
  ├── consume Change Files
  ├── bump lockstep version
  ├── update package changelogs
  ├── update the product changelog
  └── validate npm packages and Docker image
        ▼
tag vX.Y.Z and publish
```

The existing `scripts/version.mjs` should only be removed after Rush demonstrably covers its requirements.

No Rush subspaces, multiple lockfiles, or remote build cache are needed initially. The private Cloud repository, when it exists, has its own independent release cycle and may adopt Rush separately.

## 16. Refactoring sequence

### Phase 1: Establish the inward core boundary

- Rename `packages/model` to `packages/core` and the package to `@micacms/core`.
- Move only framework-independent content, protocol, capability, and repository port types into it.
- Update Astro and editor imports without changing behavior.
- Add dependency rules that prevent `core` from importing Vue, Hono, OIDC, GitHub, GitLab, filesystem, or database implementations.

### Phase 2: Split the editor into UI, runtime, and local app

- Move the identity-neutral SPA to `packages/editor-ui`.
- Move the single-site API and application services to `packages/runtime`.
- Move the published local executable to `apps/local-editor`, retaining the npm name `@micacms/editor`.
- Introduce one `SiteConfig`/`SiteContext` per runtime process.
- Remove all user, login, avatar, account, and logout concepts from the editor UI.
- Enforce loopback-only networking and the auth-neutral `allowAll()` policy in the local app.
- Add dependency-graph and browser-bundle tests proving that auth code is absent.

### Phase 3: Split repository adapters

- Move the provider-neutral contract into `@micacms/core`.
- Create `packages/connectors/local`, `packages/connectors/github`, and `packages/connectors/gitlab` as separate packages.
- Make `apps/local-editor` depend only on the local connector.
- Keep credentials server-side behind simple secret references.
- Test commits, branches, conflicts, and optional pull/merge request workflows.

### Phase 4: Implement content staging and batch publishing

- Add provider-neutral draft, change-set, revision, and publish-result types to `@micacms/core`.
- Add `ContentStagingService` and its API to `@micacms/runtime`.
- Build Recent changes, validation, discard, commit-message, and Publish UI in `@micacms/editor-ui` without introducing user concepts.
- Use the local working tree as the local draft workspace and restrict commits to reviewed Mica-managed paths.
- Extend all repository connectors with expected-revision batch publication.
- Add persistent self-hosted draft storage and backup guidance.
- Test publish conflicts, validation failures, concurrent autosaves, push failure recovery, and duplicate-commit prevention.

### Phase 5: Add self-hosted OIDC as a separate adapter and app

- Add `packages/auth/oidc` with package name `@micacms/auth-oidc` and no browser entry point.
- Add `apps/self-hosted` with package name `@micacms/self-hosted` as the authenticated composition root.
- Keep `@micacms/editor`, `@micacms/editor-ui`, and `@micacms/runtime` independent from the OIDC implementation.
- Add generic OIDC plus optional Google Workspace and Microsoft Entra presets.
- Start with one admitted-user capability profile rather than a user/role database.
- Provide Docker and Compose deployment paths.

### Phase 6: Reorganize examples, deployments, and tests

- Move `sites/` to `examples/` with names that describe the demonstrated topology.
- Move deployment assets from `demo/` and the repository root to `deploy/`.
- Move `e2e/` to `tests/e2e/`.
- Update documentation and CI paths without mixing further behavior changes into the move.

### Phase 7: Migrate release management to Rush

- Add `rush.json` and `common/config/rush/`.
- Preserve the existing pnpm dependency graph during migration.
- Mark publishable and private projects explicitly.
- Introduce lockstep versioning and mandatory Change Files.
- Replace the old version script only after equivalent release validation exists.

### Phase 8: Mature the open-source product

- Prioritize editor quality, content model stability, migrations, conflict handling, backup/recovery documentation, observability, and upgrade safety.
- Operate real single-site deployments and learn from them.
- Avoid designing the Cloud control plane through speculative abstractions.

### Phase 9: Build Cloud separately

- Create the private Cloud repository only when the OSS runtime boundaries are stable.
- Consume pinned, published Mica releases.
- Add tenant, membership, role, provisioning, billing, and operations models in Cloud.
- Reuse the single-site runtime instead of forking the editor or content model.
- Support both central Mica Cloud hosting and commercially operated agency deployments.

## 17. Non-goals

- no authentication code in the local `@micacms/editor` distribution,
- no synthetic local user,
- no user/account chrome in the local editor UI,
- no built-in password or MFA implementation,
- no tenant or multi-site model in the initial OSS runtime,
- no OSS membership or invitation administration,
- no Cloud code in the public repository,
- no fork of the editor for Cloud,
- no mandatory identity platform for self-hosters beyond their existing OIDC provider,
- no per-user draft queues or approval workflow in the initial staging implementation,
- no automatic force push, rebase, or silent merge during publication,
- no general-purpose plugin framework,
- no package split without a distribution, dependency, or responsibility boundary,
- no shared release workspace between OSS and Cloud.

## 18. Acceptance criteria

The initial architecture is successfully implemented when all of the following are true:

### Local

- `npx @micacms/editor` starts a useful single-site editor.
- It installs no OIDC package and bundles no authentication implementation.
- The UI contains no user, account, login, or logout elements.
- It is reachable only through loopback.
- Autosave changes the working tree without committing or pushing.
- Recent changes lists only Mica-managed content/media changes.
- Publish commits only the reviewed path set and uses the developer's configured Git authentication to push.
- A failed push is recoverable without creating a duplicate commit.

### Self-hosted

- A Docker/Compose deployment protects one site with generic OIDC.
- Google Workspace, Microsoft Entra, Keycloak, Authentik, or ZITADEL can be used without changing editor code.
- Unauthenticated or non-admitted users cannot access editor APIs.
- Authenticated admitted users can edit the configured site without a Mica user database.
- GitHub and GitLab connectors work with operator-provided credentials.
- Autosaved drafts survive a runtime restart without creating remote commits.
- Publish creates one provider-side commit for the complete validated change set.
- An advanced remote branch or concurrent draft edit is detected instead of overwritten.

### Content staging

- The UI distinguishes Saved from Published.
- The site has one shared pending change set with a recorded base revision.
- Invalid staged content cannot be published.
- Successful publication clears only the snapshot that was actually published.
- Production rebuilds are triggered by the successful remote update, not by autosave.
- No connector creates one commit per field or per autosaved document.

### Architecture

- `@micacms/core` has no framework or provider dependencies.
- `@micacms/editor` has no direct or transitive dependency on OIDC, GitHub, or GitLab packages.
- The self-hosted app composes, rather than forks, `@micacms/runtime` and `@micacms/editor-ui`.
- One runtime has exactly one `SiteContext`.
- There are no tenant or membership tables in the OSS runtime.
- Cloud remains optional and cannot affect the OSS build or release.

## 19. Decision summary

| Topic                      | Decision                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| OSS topology               | exactly one site per runtime                                                                                    |
| Local authentication       | none; authentication/user concepts are completely absent                                                        |
| Local distribution         | `npx @micacms/editor`, with no OIDC dependency or auth bundle code                                              |
| Local networking           | loopback only, with no public unauthenticated override                                                          |
| Self-hosted authentication | external generic OIDC                                                                                           |
| Self-hosted users          | initially no user database or role administration                                                               |
| Editor architecture        | identity-neutral editor mounted by local, self-hosted, or future Cloud shells                                   |
| Core package               | `packages/core` / `@micacms/core`, replacing `model` and owning framework-independent domain and port contracts |
| Runnable products          | `apps/local-editor` and `apps/self-hosted`                                                                      |
| Editor internals           | separate `@micacms/editor-ui` and auth-neutral `@micacms/runtime` packages                                      |
| Repository adapters        | separate local, GitHub, and GitLab packages under `packages/connectors/`; all remain OSS                        |
| OIDC adapter               | server-only `packages/auth/oidc`; imported only by the self-hosted composition                                  |
| Content topology           | combined repository by default; split UI/content repositories optional                                          |
| Autosave                   | persists to a Mica draft workspace and never commits or pushes                                                  |
| Publish                    | validates the shared pending change set and writes one commit plus remote update                                |
| Local staging              | checked-out working tree, restricted to Mica-managed paths                                                      |
| Self-hosted staging        | persistent draft store outside Git until Publish                                                                |
| Publish conflicts          | optimistic base-revision check; block rather than force or silently merge                                       |
| Multi-site and tenants     | deferred to private Cloud/control-plane software                                                                |
| Agency offering            | private Cloud platform may be installed and operated as a commercial service                                    |
| Cloud runtime model        | initially one isolated OSS Mica runtime per site                                                                |
| Repository boundary        | Cloud consumes published OSS artifacts; OSS never imports Cloud                                                 |
| Package manager            | pnpm remains; Rush manages the monorepo and releases                                                            |
| Versioning                 | one lockstep Mica version initially                                                                             |
| Delivery order             | mature local and self-hosted OSS before building Cloud                                                          |
