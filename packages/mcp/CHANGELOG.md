# Change Log - @micacms/mcp

This log was last generated on Tue, 27 Oct 2026 16:53:31 GMT and should not be manually modified.

## 0.16.0
Tue, 27 Oct 2026 16:53:31 GMT

### Minor changes

- On a multilingual site, list_entries gives the missing translations of each entry, and its option missing lists the entries that miss one locale.

## 0.15.0
Mon, 26 Oct 2026 14:15:44 GMT

### Minor changes

- Breaking: the tools take and give id in place of slug: get_entry({ collection, id }), save_entry, delete_entry, find_references, reorder_entries({ ids }), and the id of each entry in list_entries and get_entry.

## 0.14.0
Sun, 25 Oct 2026 18:05:04 GMT

_Version update only_

## 0.13.0
Sat, 24 Oct 2026 13:39:21 GMT

_Version update only_

## 0.12.0
Mon, 19 Oct 2026 07:02:35 GMT

### Patches

- An MCP tool writes a full or read-only disk to the log as an error, as the editor does.

## 0.11.0
Sun, 18 Oct 2026 06:05:29 GMT

### Minor changes

- upload_media takes GPX, KML, GeoJSON, ZIP and CSV files, and a list of types in accept.
- describe_model names the reference sets, and find_reference_items searches their items.
- While a newer content model cannot be read, the tools that write refuse with a message that says why; the tools that read go on.

### Patches

- describe_model says that a coordinates value can have a zoom.

### Updates

- Run the tests without a build first.

## 0.10.0
Thu, 15 Oct 2026 04:37:22 GMT

### Minor changes

- New package: the Mica tools for agents over the Model Context Protocol (2026-07-28, and the 2025 revisions). Agents read the model and the content, save drafts with revisions, upload media, and publish only when allowed.

