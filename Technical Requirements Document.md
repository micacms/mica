# Technical Requirements Document

## Lightweight CMS + Astro SSG Starter for SME Websites

## 1. Purpose

This document defines the technical requirements for a reusable website starter intended for small and medium-sized businesses.

The starter should provide:

- a lightweight, production-ready CMS
- a simple editorial interface suitable for non-technical users
- Astro as the static frontend framework
- Astro Content Collections as the frontend content abstraction
- a shared schema definition used by both CMS and frontend
- minimal operational complexity
- low maintenance requirements
- deployment independence from specific Git or hosting providers
- a reusable architecture suitable for multiple customer projects

The system is explicitly not intended to compete with general-purpose CMS platforms such as WordPress, Directus, Strapi, or Contentful.

Its primary use case is relatively small, content-driven business websites with a limited number of editors and structured content types such as:

- pages
- projects
- properties
- team members
- news
- references
- locations
- site configuration
- navigation
- theme configuration

The system should remain intentionally small and understandable.

The name of the CMS is "Mica CMS". Also the namespace should be `@micacms`.

---

# 2. Design Principles

The architecture should follow these principles.

## 2.1 Minimal operational complexity

The CMS should require as little infrastructure as reasonably possible.

The preferred default deployment should consist of:

- one application server
- one SQLite database
- one persistent media directory
- one container or process

External managed services should not be mandatory.

---

## 2.2 Static public website

The public-facing website should be statically generated using Astro.

The CMS must not be required at runtime for normal website visitors.

The resulting production website should consist primarily of static assets:

- HTML
- CSS
- JavaScript
- images
- fonts

This reduces:

- attack surface
- hosting requirements
- runtime dependencies
- maintenance burden
- performance variability

---

## 2.3 Single source of truth for schemas

Content structures must not be defined independently in both Astro and the CMS.

A shared content model must act as the authoritative schema definition.

From this model, the system should derive:

- TypeScript types
- runtime validation
- CMS form definitions
- Astro Content Collection schemas
- API validation

Example:

```ts
export const projects = collection({
  label: "Projects",

  fields: {
    title: text({
      label: "Title",
      required: true,
    }),

    slug: slug({
      from: "title",
    }),

    description: richText(),

    year: number(),

    location: object({
      fields: {
        lat: number(),
        lng: number(),
      },
    }),

    gallery: media({
      multiple: true,
    }),
  },
});
```

The schema language should remain framework-independent.

Astro-specific APIs must not become part of the core model package.

---

## 2.4 CMS independence from frontend hosting

The CMS must not depend on:

- GitHub
- GitLab
- Vercel
- Netlify
- Cloudflare
- any specific CI provider

The public website may be deployed to any static hosting provider.

Publishing should use a generic build-trigger mechanism.

---

## 2.5 Technology should remain boring

Modern web technologies should be used where they improve the architecture.

Technology must not be introduced purely for novelty.

Examples of appropriate technologies:

- ESM
- TypeScript
- Web APIs
- Fetch
- Request / Response
- Web Crypto
- CSS custom properties
- Vue Composition API
- Astro Content Layer
- SQLite JSON functionality

WASM should only be introduced where it solves a concrete problem.

---

# 3. Repository Architecture

The project should use a pnpm monorepo.

Recommended initial structure:

```text
/
├── apps/
│   ├── web/
│   └── cms/
│
├── packages/
│   ├── model/
│   ├── astro-cms/
│   └── cms-client/
│
├── pnpm-workspace.yaml
├── package.json
└── docker-compose.yml
```

Additional packages should only be introduced when repeated usage demonstrates a clear need.

For example, a dedicated UI package should not exist merely for architectural cleanliness.

---

# 4. Shared Content Model

## 4.1 `packages/model`

The `model` package is the central source of truth.

It should describe:

- content collections
- singleton content
- global configuration
- theme settings
- field definitions
- validation rules
- editor metadata

Example:

```ts
export const site = defineSite({
  collections: {
    projects: collection({
      label: "Projects",

      fields: {
        title: text({
          label: "Title",
          required: true,
        }),

        slug: slug({
          from: "title",
        }),

        description: richText(),

        year: number(),

        location: object({
          fields: {
            lat: number(),
            lng: number(),
          },
        }),

        gallery: media({
          multiple: true,
        }),
      },
    }),
  },

  globals: {
    site: singleton({
      label: "Site",

      fields: {
        companyName: text(),
        address: text(),
        email: email(),
        logo: media(),
      },
    }),

    theme: singleton({
      label: "Theme",

      fields: {
        primaryColor: color(),
        accentColor: color(),
      },
    }),
  },
});
```

---

## 4.2 Supported field types

The initial implementation should support at least:

```text
text
textarea
richText
number
boolean
date
email
url
slug
select
object
repeater
relation
media
color
coordinates
```

Additional field types should only be added based on real customer requirements.

---

## 4.3 Schema-derived outputs

The shared schema should generate or expose:

```text
Content Model
     │
     ├── TypeScript types
     ├── runtime validation
     ├── CMS forms
     ├── API validation
     └── Astro collection schemas
```

An internal validation library such as Zod may be used.

However, Zod should not necessarily be the public configuration API because validation alone does not provide sufficient information for generating editorial interfaces.

For example:

```ts
text({
  label: "Project title",
  required: true,
  maxLength: 120,
});
```

contains more UI semantics than:

```ts
z.string().max(120);
```

The schema DSL may internally generate Zod schemas.

---

# 5. CMS Architecture

## 5.1 CMS frontend

The CMS interface should be a lightweight Single Page Application.

Preferred stack:

```text
Vue 3
TypeScript
Vite
Tailwind CSS
```

No full-stack frontend framework should be required.

Explicitly excluded:

- Next.js
- Nuxt
- server-rendered admin frameworks

The CMS frontend should compile to static assets served by the CMS application.

---

## 5.2 CMS server

The CMS should use a small HTTP server based on Web Platform APIs.

Preferred option:

```text
Hono
```

Reference runtime:

```text
Node.js LTS
```

The architecture should not unnecessarily depend on Node-specific APIs where Web APIs are sufficient.

---

## 5.3 Deployment topology

The CMS should be deployable as a single application:

```text
cms.example.com
       │
       ▼
      Hono
   ┌────┴───────────┐
   │                │
 /api/*         /admin/*
   │                │
SQLite           Vue SPA
```

The application should expose:

- CMS API
- administration SPA
- media assets
- health endpoint

---

# 6. Data Storage

## 6.1 SQLite

SQLite should be the default database.

The expected workload consists of:

- few editors
- low write concurrency
- hundreds or low thousands of content entries
- relatively infrequent updates

This makes SQLite suitable for the default SME use case.

PostgreSQL support may be considered later but is not required for the initial implementation.

---

## 6.2 Generic content storage

The CMS should not create dedicated SQL tables for each collection.

Instead, content entries should use a generic model.

Example:

```text
entries
-------
id
collection
slug
status
data
created_at
updated_at
published_at
version
```

The `data` field contains JSON.

Example:

```json
{
  "title": "Buchholzstrasse",
  "year": 2024,
  "description": "...",
  "location": {
    "lat": 47.37,
    "lng": 8.59
  },
  "gallery": ["01ABC", "01DEF"]
}
```

The JSON data must be validated using the collection schema.

This avoids SQL migrations whenever customer content models change.

---

## 6.3 Core tables

The initial CMS database should contain approximately:

```text
entries
globals
media
revisions
users
sessions
```

The database should remain intentionally simple.

---

## 6.4 ORM

No ORM is required initially.

Direct SQL is preferred if the database remains limited to a small number of stable tables.

Database access should nevertheless be encapsulated behind small repository modules so that the underlying SQLite driver can later be replaced.

---

# 7. Content States

The CMS should support at least:

```text
Draft
Published
```

A content entry must not become publicly visible until explicitly published.

The Astro build API must expose only published content.

Possible future states such as scheduled publishing are outside the V1 scope.

---

# 8. Revisions

Revision history should be part of the initial production-ready version.

For every relevant content modification, the previous version should be recoverable.

Required functionality:

- show revision history
- inspect previous versions
- restore a previous revision
- identify modification timestamp
- identify editor where possible

For SME users, simple rollback functionality is more valuable than complex editorial workflows.

---

# 9. Authentication

## 9.1 Requirements

The CMS requires production-ready authentication.

The initial authentication model should support:

- email address
- password
- authenticated sessions
- logout
- password reset or administrator-assisted password replacement

Public registration is not required.

---

## 9.2 Session architecture

Authentication should use server-side sessions.

Preferred flow:

```text
email + password
      │
      ▼
password hash verification
      │
      ▼
SQLite session
      │
      ▼
Secure HttpOnly cookie
```

Cookies should use appropriate settings:

```text
Secure
HttpOnly
SameSite
```

JWT-based authentication is not required.

---

## 9.3 Security

Password hashing must use a proven cryptographic implementation.

The system must not implement custom cryptographic algorithms.

Authentication should include:

- secure password hashing
- CSRF protection where relevant
- rate limiting for login attempts
- secure session generation
- session expiration
- protection against session fixation

---

# 10. CMS User Interface

The administration interface must prioritize usability for non-technical editors.

The CMS should not resemble a database administration interface.

Primary navigation may be generated automatically from the shared schema.

Example:

```text
Projects
Pages
News
Media

Website
Theme

Users
```

Collection overview:

```text
Projects
────────────────────────────

Buchholzstrasse       Published
Hirzenbach I          Published
Bleicherweg           Draft

                    + New project
```

Entry editor:

```text
Title
[Buchholzstrasse                       ]

URL
[buchholzstrasse                       ]

Year
[2024                                  ]

Location
[ map / coordinates                    ]

Images
[ image ] [ image ] [ + ]

Description
┌──────────────────────────────────────┐
│                                      │
└──────────────────────────────────────┘

[Save draft]               [Publish]
```

The UI should be:

- responsive
- keyboard accessible
- simple
- visually modern
- usable on tablets
- usable without knowledge of Markdown or HTML

---

# 11. Form Generation

CMS forms should be generated from the shared content schema.

The Vue application should maintain a field registry.

Example:

```ts
const fieldComponents = {
  text: TextField,
  number: NumberField,
  boolean: BooleanField,
  richText: RichTextField,
  media: MediaField,
  object: ObjectField,
  repeater: RepeaterField,
  color: ColorField,
  date: DateField,
  relation: RelationField,
};
```

Field rendering should support recursive structures for:

- nested objects
- repeaters
- related entries

Custom field components may be added later, but no plugin architecture is required in V1.

---

# 12. Media Management

## 12.1 Default storage

The default media implementation should use local persistent storage.

Example:

```text
/data/
├── cms.sqlite
└── media/
    ├── 01ABC.jpg
    ├── 01DEF.webp
    └── ...
```

The media database should contain metadata such as:

```text
id
filename
mime_type
width
height
size
alt_text
created_at
```

---

## 12.2 Storage abstraction

Media storage should be accessed through a small internal interface.

Example:

```ts
interface MediaStorage {
  put(...)
  get(...)
  delete(...)
}
```

Initial implementation:

```ts
localStorage();
```

Possible future implementations:

```ts
s3Storage();
r2Storage();
```

S3-compatible storage must not be required for V1.

---

# 13. Astro Frontend

## 13.1 Framework

The public website should use:

```text
Astro
TypeScript
Tailwind CSS
```

The default output mode should be static site generation.

---

## 13.2 Astro Content Collections

Content retrieved from the CMS should appear inside the Astro application as normal Content Collections.

Example:

```ts
const projects = await getCollection("projects");
```

The website should not have to know the CMS implementation details.

---

## 13.3 Astro integration package

`packages/astro-cms` should translate the shared model into Astro collections.

Conceptually:

```ts
import { createAstroCollections } from "@starter/astro-cms";
import { site } from "@starter/model";

export const collections = createAstroCollections(site, {
  endpoint: process.env.CMS_URL!,
  token: process.env.CMS_READ_TOKEN!,
});
```

Internally, the integration should use Astro's Content Loader API.

The CMS therefore acts as an external content source during the build.

---

# 14. Typed CMS Client

A small typed API client should be provided through:

```text
packages/cms-client
```

Example:

```ts
const projects = await cms.projects.list();
```

or internally:

```text
GET /api/content/projects
```

The API client should derive types from the shared model.

The public website should not manually define CMS response interfaces.

---

# 15. Public Content API

The CMS should expose a read-only endpoint intended for static builds.

Example:

```text
GET /api/content/projects
GET /api/content/projects/:slug
GET /api/globals/site
GET /api/globals/theme
```

The endpoint should:

- require a build/read token
- return published content only
- return validated content
- be safe for CI usage

The API does not need GraphQL.

---

# 16. Publishing

## 16.1 Publish workflow

The desired publishing process is:

```text
Editor
   │
   │ Publish
   ▼
CMS
   │
   ├── update database
   │
   ├── create revision
   │
   └── trigger webhook
                │
                ▼
            CI / Build
                │
                ▼
           astro build
                │
                ▼
          static website
```

---

## 16.2 Hosting independence

The CMS must not know which platform hosts the public website.

Publishing should be implemented through an abstraction.

Example:

```ts
interface Publisher {
  publish(event: PublishEvent): Promise<void>;
}
```

Default implementation:

```ts
publisher: webhook({
  url: process.env.BUILD_WEBHOOK_URL,
  secret: process.env.BUILD_WEBHOOK_SECRET,
});
```

This allows integration with:

- GitHub Actions
- GitLab CI
- Vercel
- Netlify
- Cloudflare
- custom CI
- self-hosted build infrastructure

---

## 16.3 Webhook security

Publishing webhooks should support:

- configurable secret
- request signatures
- timestamp or replay protection where appropriate

---

# 17. Theme Configuration

Theme values may be managed as singleton CMS configuration.

Example:

```ts
theme: singleton({
  fields: {
    primaryColor: color(),
    accentColor: color(),
    fontFamily: select(...),
    borderRadius: select(...),
  },
})
```

The frontend should translate these values into design tokens or CSS custom properties.

The CMS should not allow arbitrary CSS editing by default.

---

# 18. Site Configuration

Global configuration may include:

```text
Company name
Logo
Address
Phone
Email
Social links
Default SEO settings
Navigation
Footer content
Analytics configuration
Map settings
```

Site configuration should use the same shared schema mechanism as collections.

---

# 19. Maps

For projects requiring maps, the preferred frontend mapping stack is:

```text
MapLibre GL JS
```

Map configuration should be independent from the CMS core.

Location fields may expose:

```ts
coordinates({
  lat: ...,
  lng: ...,
})
```

or a dedicated map field in the admin UI.

The CMS should store neutral geographic coordinates rather than provider-specific map data.

---

# 20. Backups

The default CMS deployment should be trivial to back up.

A complete backup consists primarily of:

```text
SQLite database
+
media directory
```

The system should support safe SQLite snapshots.

The deployment documentation should recommend automated scheduled backups to an external location.

Backup strategy should not depend on a specific hosting provider.

---

# 21. Deployment

## 21.1 CMS

The reference deployment should support:

```bash
docker compose up -d
```

The CMS container requires:

```text
Node.js application
Vue SPA assets
SQLite
/data persistent volume
```

Environment configuration should contain values such as:

```text
CMS_BASE_URL
SESSION_SECRET
CMS_READ_TOKEN
BUILD_WEBHOOK_URL
BUILD_WEBHOOK_SECRET
```

---

## 21.2 Public website

The Astro application must produce a standard static build.

It should be deployable to:

- Vercel
- Netlify
- Cloudflare Pages
- GitHub Pages
- GitLab Pages
- S3-compatible static hosting
- nginx
- Apache
- arbitrary CDN/static hosting

No specific platform adapter should be mandatory.

---

# 22. Production Requirements

V1 must be suitable for real customer production use.

At minimum, this includes:

- secure authentication
- persistent sessions
- input validation
- schema validation
- media upload validation
- draft/publish workflow
- revision history
- backups
- health checks
- structured error handling
- logging
- CSRF protection where necessary
- secure cookies
- rate limiting on authentication
- safe webhook triggering
- deterministic database migrations
- documented deployment
- documented restore procedure

---

# 23. Explicitly Out of Scope for V1

The following features should not be implemented initially:

- GraphQL
- plugin marketplace
- plugin architecture
- visual page builder
- arbitrary database modeling UI
- multi-stage approval workflows
- real-time collaboration
- arbitrary custom SQL relationships
- public user registration
- customer-facing authentication
- SaaS multi-tenancy
- billing
- subscriptions
- comments
- e-commerce
- arbitrary server-side extensions
- marketplace ecosystem
- mandatory cloud services

This boundary is important to prevent the project from becoming another general-purpose CMS.

---

# 24. Architecture Summary

```text
┌────────────────────────────────────────────┐
│               pnpm monorepo                │
│                                            │
│  packages/model                            │
│  Shared content/schema definition          │
│                                            │
│  ├── TypeScript types                      │
│  ├── runtime validation                    │
│  ├── CMS field metadata                    │
│  └── Astro schema generation               │
└───────────────────┬────────────────────────┘
                    │
            ┌───────┴─────────┐
            │                 │
            ▼                 ▼

┌──────────────────────┐   ┌──────────────────────┐
│        CMS           │   │      Astro Web       │
│                      │   │                      │
│ Vue 3 SPA            │   │ Astro SSG            │
│ Tailwind             │   │ Content Collections  │
│ Vite                 │   │ Tailwind             │
│        │             │   │                      │
│        ▼             │   │        ▲             │
│ Hono API             │   │        │             │
│        │             │   │ CMS Content Loader   │
│        ▼             │   │        │             │
│ SQLite + Media       │───┼────────┘             │
└──────────┬───────────┘   └──────────┬───────────┘
           │                          │
           │ publish webhook          │ build
           ▼                          ▼
        CI system               Static assets
                                     │
                                     ▼
                              arbitrary hosting
```

---

# 25. Recommended Initial Technology Stack

## Monorepo

```text
pnpm workspaces
TypeScript
```

## Public website

```text
Astro
Astro Content Collections
Astro Content Layer
Tailwind CSS
```

## CMS frontend

```text
Vue 3
Vite
Tailwind CSS
TypeScript
```

## CMS backend

```text
Hono
Node.js LTS
SQLite
```

## Validation

```text
Custom schema DSL
Zod internally
```

## Storage

```text
SQLite
Local filesystem
```

## Deployment

```text
Docker
Docker Compose
Generic build webhooks
```

---

# 26. Long-Term Architecture Philosophy

The starter should primarily be a project template, not a central platform.

Each customer project should remain independently deployable and maintainable.

Customer websites should not depend on a permanently evolving shared runtime package that forces synchronized upgrades across all customer installations.

Reusable code may be copied or scaffolded into new projects.

Shared packages should only be maintained where their continued reuse produces a clear benefit.

The architecture should optimize for:

1. understandable code
2. low operational overhead
3. low attack surface
4. easy backup and recovery
5. good editor experience
6. static frontend performance
7. minimal vendor lock-in
8. long-term maintainability
9. predictable project scope
10. reuse across SME customer projects

The desired end result is not a universal CMS.

It is a small, schema-driven content backend designed specifically to support static, content-driven business websites built with Astro.
