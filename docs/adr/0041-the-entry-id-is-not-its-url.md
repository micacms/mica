# 41. An entry has an ID, and its page has a URL

**Status:** Accepted

## Context

An entry's identity is one part of lower-case letters, digits and hyphens: the name of its folder, and what a relation stores. The page of an entry has a URL. A collection's `url` builds it, and it can have several parts, such as `/{activity}/{id}`. The identity is then only one part of the address. Editors must not read the identity as the address.

## Decision

- The entry's identity is its **ID** in the model, the code, the API, the tools for agents and the editor: `id()` with the field kind `"id"`, `idField`, `{id}` in a `url`, and `id` in the admin HTTP API and the MCP tools. The examples name the field `id`, with the label "ID".
- The **URL** is only the page's address: the collection's `url` with its names filled in. The editor shows it read-only under the ID field, in the collection list and in the relation pickers, for a collection with a `url`.
- One word means one thing in the whole code base. Astro calls the entry's identity `entry.id`.
- There is no converter and no reader for other field kinds before 1.0.

## Consequences

- The content files hold the ID under the key that the model gives to the `id()` field.
- "Change ID" moves the entry's folder and can change the links to it. The editor names the old and the new URL of the page when the collection has a `url`.
