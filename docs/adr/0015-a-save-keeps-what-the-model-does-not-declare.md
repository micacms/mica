# 15. A save keeps what the model does not declare

**Status:** Accepted

## Context

The model and the content can come in different commits. A save with an older model must not delete the content of a newer field. A default that applies on read would bring back a cleared field, and a new default would change all entries without a diff.

## Decision

- A save keeps the keys of `index.json` and the `.mdoc` files that the model does not declare: at the top, in objects, and in list rows with a `_key`. They come after the declared keys, in their stored order.
- A save deletes a `.mdoc` file only when the model declares it and the field is empty or its row is gone. An ID change moves all files of the folder.
- A `default` fills a field of a new entry, and of a singleton without a file. A read fills a missing value with the empty value (`null`, `false`, `[]`), never with the default.
- `mica check` warns about keys and files that the model does not declare. The recipes `remove-field.mjs` and `rename-field.mjs` remove or rename a field's content in one commit.

## Consequences

- A field that leaves the model leaves its values in the files until the recipe removes them.
- A key in a list row without `_key` is not kept, because such a row has no identity across a new order.
- Templates must handle a missing optional value.
- These rules are part of the content format and do not change in 1.x.
