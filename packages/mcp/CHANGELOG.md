# Change Log - @micacms/mcp

This log was last generated on Mon, 19 Oct 2026 07:02:35 GMT and should not be manually modified.

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

