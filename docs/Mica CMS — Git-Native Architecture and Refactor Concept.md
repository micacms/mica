# Mica CMS — Git-Native Architecture and Refactor Concept

**Status:** Proposed architecture for the Mica refactor  
**Scope:** Mica CMS, `@micacms/*`, Mica Cloud and self-hosted deployments

## 1. Purpose

Mica is a Git-native authoring system for static Astro websites.

Its primary purpose is simple:

> Make an Astro website editable by non-technical users without introducing a separate content backend.

Mica provides:

- an authoring-oriented content model for Astro
- collections and singletons as first-class content primitives
- a generated editor for non-technical users
- authenticated access to Git repositories
- GitHub and GitLab repository connectors
- local, self-hosted and managed-cloud operation
- optional multi-tenancy for agencies and organizations

The Git repository is the authoritative content store.

Mica does **not** maintain a second copy of website content in a CMS database.

The public Astro website remains statically generated and requires no Mica runtime.

---

# 2. Product principles

## 2.1 Git is the source of truth

All persistent editorial content and media managed by Mica live in Git.

Git provides:

- persistence
- revision history
- rollback
- auditability
- backup through normal repository replication
- the trigger for the existing CI/CD workflow

Mica must not introduce an independent content database.

## 2.2 Git is invisible to editors

Git is an architectural mechanism, not part of the editorial UX.

Editors see:

- Edit
- Save draft
- Preview
- Publish
- Publishing…
- Published
- Restore previous version

They should not need to understand commits, branches, SHA hashes, push/pull or repository permissions.

Repository identity and editor identity are deliberately separate.

## 2.3 Astro-first rather than framework-neutral

Mica is specifically designed for Astro.

It may impose conventions on a Mica-enabled Astro project where doing so simplifies authoring.

Compatibility with arbitrary existing Astro Content Collections is not a goal.

Mica instead provides an authoring-first Content Loader that exposes normal Astro Content Collections to the website.

## 2.4 The public website remains completely static

Mica must never require the public website to use SSR, a Node adapter or a Mica runtime.

```text
Git repositories
      │
      ▼
 Astro build
      │
      ▼
    dist/
      │
      ▼
arbitrary static host
```

## 2.5 Simple deployments must stay simple

Advanced infrastructure may exist in Mica Cloud, but it must not become mandatory for a single self-hosted site.

---

# 3. Operating modes

Mica supports three operating modes using the same core software.

## 3.1 Local

Used primarily during development.

```text
localhost
   │
   ▼
Mica Server + Editor
   │
   ▼
local repository / Git remote
```

Characteristics:

- binds to localhost only
- no user authentication required
- repository credentials may come from the developer environment or local credential store
- optimized for development and content-model testing

## 3.2 Self-hosted

The user or agency operates Mica.

```text
cms.agency.example
        │
        ▼
    Mica Server
     │       │
     │       └── OIDC Provider
     │
     └────────── GitHub / GitLab
```

Characteristics:

- one Mica installation may serve one or many sites
- authentication is OIDC-only
- no built-in passwords
- repository credentials remain under the operator's control
- SQLite may be used for small Mica operational state
- content and media remain in Git

## 3.3 Mica Cloud

`app.micacms.com` is a managed deployment of the same Mica software.

Mica Cloud operates:

- Mica Server
- Mica Editor
- OIDC infrastructure
- tenant/site configuration
- encrypted repository credentials
- repository connectors

It does not become the authoritative store for content, media, revisions or website builds.

---

# 4. Core architecture

```text
                       ┌───────────────────────┐
                       │      Mica Editor      │
                       │       Vue SPA         │
                       └───────────┬───────────┘
                                   │
                            Mica HTTP API
                                   │
                       ┌───────────▼───────────┐
                       │      Mica Server      │
                       │         Hono          │
                       │                       │
                       │ authorization         │
                       │ sites / tenants       │
                       │ repo connections      │
                       └─────┬───────────┬─────┘
                             │           │
                          OIDC        Connector
                             │           │
                             ▼           ▼
                           IdP      GitHub/GitLab
                                         │
                                         ▼
                                  Content repository
                                         │
                                         ▼
                                        CI
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │    Astro website    │
                              │ @micacms/astro      │
                              └──────────┬──────────┘
                                         │
                                         ▼
                                   static output
```

Mica Server is primarily:

> authentication integration + authorization + repository gateway

It is no longer a content backend.

---

# 5. Repository architecture

Mica supports two repository topologies as first-class configurations.

## 5.1 Single repository

```text
website/
├── src/
├── public/
├── content/
├── astro.config.ts
├── package.json
└── ...
```

This is the simplest default.

## 5.2 Separate UI and content repositories

```text
website-ui/
├── src/
├── astro.config.ts
└── package.json

website-content/
├── projects/
├── news/
├── team/
├── site/
└── media/
```

Mica receives write permission only for `website-content`.

This limits the blast radius of compromised Mica repository credentials.

### Submodules

Git submodules may be used as one mechanism for making the content repository available to the UI repository, but they are not part of the Mica data model.

Possible CI strategies include:

- independent checkout of both repositories
- Git submodule
- provider-specific CI mechanisms

`@micacms/astro` only requires a resolved local content path at build time.

---

# 6. Mica content model

The content model is one of the parts of the existing Mica architecture that should be retained.

The current implementation already follows the valuable principle that editorial semantics are defined once and used to derive validation, generated forms and Astro types.

The refactored model has two first-class content primitives:

```text
Mica content model
│
├── Collections
│     0..n entries
│
└── Singletons
      exactly one value
```

Both use the **same field system, validation system and editor components**.

They differ only in cardinality, storage conventions and editor UX.

## 6.1 Collections

Collections represent repeatable entities such as:

- projects
- news articles
- team members
- properties
- references

A collection contains zero or more independently addressable entries.

Conceptually:

```ts
projects: collection({
  label: "Projects",

  fields: {
    title: text(),
    year: number(),
    description: richText(),
  },
})
```

The editor presents collections primarily as lists:

```text
Projects

Buchholzstrasse
Hirzenbach
Bleicherweg

                  + New project
```

Collections support operations such as:

- create
- edit
- delete
- optionally reorder
- derive or edit an identifier/slug

## 6.2 Singletons

Singletons represent content for which exactly one instance exists.

Typical examples:

- site information
- navigation
- footer
- default SEO configuration
- theme configuration
- contact information

Conceptually:

```ts
site: singleton({
  label: "Site",

  fields: {
    companyName: text(),
    email: email(),
    logo: media(),
  },
})
```

A singleton:

- has exactly one value
- does not require a slug
- is opened directly as a form
- cannot be created or deleted by an editor

The editor may therefore expose singletons directly in navigation:

```text
Content
  Projects
  News
  Team

Website
  Site
  Navigation
  Theme
```

The existing Mica already models this distinction through collections and global singletons; the refactor should preserve it while using the clearer public term `singleton`.

## 6.3 Shared field system

Collections and singletons must use exactly the same field definitions.

For example:

```ts
const contactFields = {
  email: email(),
  phone: text(),
};

collection({
  fields: contactFields,
});

singleton({
  fields: contactFields,
});
```

There must not be separate validation, serialization or editor systems for singleton content.

## 6.4 Astro integration

Mica-specific content definitions live with the Astro content configuration.

Conceptually:

```ts
import { defineCollection } from "astro:content";
import {
  micaLoader,
  collection,
  singleton,
  text,
  number,
  richText,
  media,
} from "@micacms/astro";
```

The exact public API should be refined during implementation, but there should be no independently deployed `mica.config.ts`.

From the Mica model the integration derives:

```text
Mica model
   │
   ├── Astro collections/types
   ├── runtime validation
   ├── content parser
   ├── content serializer
   └── editor manifest
```

---

# 7. Authoring format

Mica uses a deliberately constrained, Git-friendly authoring format.

## 7.1 Collection entries

A collection entry is represented as a directory when it contains rich text or colocated media:

```text
projects/
└── buchholzstrasse/
    ├── index.json
    ├── description.mdoc
    └── media/
        ├── exterior.jpg
        └── interior.jpg
```

Structured fields live in `index.json`.

Rich-text fields live in separate Markdoc files.

## 7.2 Singletons

Singletons use the same serialization rules.

A simple singleton may be stored as:

```text
site.json
theme.json
navigation.json
```

A singleton containing rich text or colocated media may instead use the normal entry-directory representation:

```text
site/
├── index.json
├── introduction.mdoc
└── media/
    └── logo.svg
```

The distinction between file and directory representation should ideally be derived automatically from the content model.

## 7.3 Structured content: JSON

JSON is the default structured format because it is:

- unambiguous
- deterministic to parse and serialize
- trivial to validate
- suitable for machine authoring
- universally supported in JavaScript tooling

## 7.4 Rich content: Markdoc

`richText()` fields are persisted as `.mdoc`.

Markdoc allows Mica to support declarative structured content blocks without making arbitrary executable JavaScript part of the canonical content format.

---

# 8. Astro integration

`@micacms/astro` becomes the main developer-facing package.

Responsibilities:

- collection and singleton definitions
- Mica field DSL
- `micaLoader()`
- Astro-compatible validation/types
- JSON parsing and serialization
- Markdoc integration
- generated Mica protocol manifest
- local development support

The Astro application should continue consuming repeatable content through normal Astro APIs such as:

```ts
const projects = await getCollection("projects");
```

Singleton access should receive an equally small typed API, for example:

```ts
const site = await getSingleton("site");
```

Whether this is implemented using Astro's Content Layer internally or as a thin Mica helper is an implementation detail to decide during the refactor.

---

# 9. Mica protocol and versioning

The Astro integration emits a versioned authoring manifest.

```json
{
  "protocolVersion": 1,
  "generatedBy": "@micacms/astro@2.0.0",
  "collections": {},
  "singletons": {}
}
```

Compatibility is defined through the Mica protocol rather than synchronized npm package versions.

Capability detection should be preferred where appropriate.

---

# 10. Repository connectors

Repository access is abstracted behind a narrow connector interface.

V1 connectors:

- GitHub
- GitLab

Future connectors may include Forgejo/Gitea.

Mica should prefer provider APIs over implementing a complete Git client in the browser.

---

# 11. Authentication and authorization

Authentication is not implemented by Mica.

## 11.1 OIDC only

Self-hosted and cloud deployments use OpenID Connect.

Recommended client:

- `panva/openid-client`

Managed Mica Cloud may use ZITADEL as its identity infrastructure.

Mica must not implement:

- passwords
- password hashing
- password reset
- MFA
- passkeys

## 11.2 Authorization

Mica maintains only its domain-specific ACL:

```text
Tenant
  └── Site
        └── Membership
              ├── administrator
              └── editor
```

---

# 12. Repository credentials and security

Repository credentials are independent from editor identity.

Preferred V1 approaches:

### GitHub

GitHub App with explicitly selected repositories and minimal repository permissions.

### GitLab

Project-scoped credentials with the narrowest useful repository scope.

Security principle:

> One compromised site connection should compromise at most the repositories explicitly connected to that site.

Separate content repositories provide an additional security boundary.

---

# 13. Secret management

Mica must not implement its own cryptographic secret store.

Local:

- environment / local developer credentials

Simple self-hosting:

- environment variables
- Docker secrets
- other platform-native secrets

Mica Cloud:

- OpenBao

ZITADEL and OpenBao are infrastructure choices for operating Mica Cloud, not mandatory dependencies for Mica users.

---

# 14. Multi-tenancy

Multi-tenancy is first-class.

```text
Mica instance
│
├── Tenant / Workspace
│   ├── Site A
│   └── Site B
│
└── Tenant / Workspace
    └── Site C
```

Each site has its own:

- repository connection
- content configuration
- users/memberships
- repository credentials

A tenant may represent an agency, organization or individual.

## Single-site mode

The same architecture supports:

```text
Mica
└── Default Site
```

A single-site operator should not have to interact with tenant concepts unless needed.

---

# 15. Mica operational database

SQLite stores operational Mica state only:

```text
tenants
sites
memberships
repository_connections
oidc_identity_mappings
```

It does not contain:

```text
collection entries
singleton content
media
content revisions
published website content
```

Consequently:

> Losing the Mica database must never mean losing website content.

---

# 16. Drafts

Published state lives in Git.

Local editing state initially uses browser storage such as OPFS or IndexedDB.

V1 does not require server-side collaborative drafts.

---

# 17. Publishing

Publishing is a repository commit.

```text
Editor
  │
  ▼
validate
  │
  ▼
serialize JSON + Markdoc + media
  │
  ▼
check repository head
  │
  ▼
atomic commit
  │
  ▼
existing Git CI/CD
  │
  ▼
Astro build
  │
  ▼
static website
```

Mica translates technical Git/CI state into editor-friendly states such as:

```text
Publishing…
Published
Publishing failed
```

---

# 18. FOSS technology baseline

| Concern | Technology |
|---|---|
| Website | Astro |
| Content integration | Astro Content Loader API |
| CMS UI | Vue 3 + TypeScript |
| UI build | Vite |
| CMS HTTP server | Hono |
| Operational DB | SQLite |
| Validation | Mica DSL + Zod internally |
| Rich content | Markdoc |
| Authentication | OpenID Connect |
| OIDC client | `panva/openid-client` |
| Managed identity | ZITADEL |
| Cloud secrets | OpenBao |
| Repository V1 | GitHub + GitLab |
| Package management | pnpm |
| Deployment | Node + Docker |

---

# 19. Explicit non-goals

V1 does not provide:

- general-purpose CMS functionality
- arbitrary framework support
- arbitrary Astro Content Collection compatibility
- page builder
- arbitrary code editing
- plugin marketplace
- complex approval workflows
- real-time collaborative editing
- custom password authentication
- custom secret-management cryptography
- server-side content persistence
- alternative CI/CD
- generic Git protocol implementation
- scheduled publishing

---

# 20. Proposed package structure

```text
packages/
├── astro/
│   ├── integration
│   ├── loader
│   ├── model
│   ├── parser
│   ├── serializer
│   └── protocol
│
├── editor/
│   └── Vue SPA
│
├── server/
│   ├── HTTP API
│   ├── OIDC
│   ├── authorization
│   ├── tenancy
│   └── repository gateway
│
└── connectors/
    ├── github/
    └── gitlab/
```

Avoid packages introduced purely for architectural neatness.

---

# 21. Refactor strategy

The existing Mica implementation should be refactored incrementally rather than rewritten wholesale.

## Phase 1 — Preserve the valuable core

Retain or extract:

- **collection vs. singleton content model**
- field DSL concepts
- validation generation
- generic Vue form renderer
- collection list UI
- singleton direct-form UI
- field components
- Astro Content Layer knowledge
- UI design
- Hono server foundation
- tests describing field semantics

Collections and singletons should continue sharing the same schema and field machinery.

## Phase 2 — Introduce Git-native content

Implement:

- `index.json` parser/serializer
- Markdoc rich-text storage
- collection directory conventions
- singleton storage conventions
- local repository abstraction
- new Mica Astro loader
- generated protocol manifest

The website should then build entirely from repository content without contacting a running CMS.

## Phase 3 — Replace content API with repository API

Remove Mica-server ownership of:

- entries
- globals/singletons
- media storage
- revisions
- public content API

Implement connector abstraction and GitHub/GitLab connectors.

## Phase 4 — Replace authentication

Remove Mica-native passwords and authentication.

Introduce:

- OIDC
- `openid-client`
- identity mapping
- minimal site ACL

## Phase 5 — Introduce site/tenant model

Add:

- tenants
- sites
- repository connections
- memberships

Expose a simple implicit default tenant/site for single-site deployments.

## Phase 6 — Deployment modes

Provide the same Mica implementation as:

```text
local
self-hosted
Mica Cloud
```

## Phase 7 — Remove obsolete infrastructure

Delete:

- SQLite content tables
- globals tables
- revision tables for content
- local media store
- CMS content backup tooling
- publish webhook system where Git CI is used
- `CMS_READ_TOKEN`
- old `mica.config.ts` deployment mechanism
- compiled CMS schema mounting

---

# 22. Definition of success

A new Astro customer project should be explainable as:

```text
1. Install @micacms/astro.
2. Define collections and singletons.
3. Put content in Git.
4. Connect the repository to Mica.
5. Invite the client.
6. Deploy Astro as a normal static site.
```

The editor workflow should be:

```text
1. Sign in.
2. Edit.
3. Preview.
4. Publish.
```

Everything involving Git, OIDC, credentials, repository APIs and CI remains an implementation detail.

The architectural test for every future feature remains:

> Does this help Mica make Git-backed Astro sites easier to author, or does it move Mica back toward becoming a general-purpose CMS?

If the latter, it should normally remain outside the product.