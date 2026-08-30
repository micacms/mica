# @micacms/model

**This package is now [`@micacms/core`](https://www.npmjs.com/package/@micacms/core).**

`@micacms/model` remains as a thin re-export for one release cycle so existing
imports keep working. Both entry points forward unchanged:

```ts
import { defineSite } from "@micacms/model";        // still works
import { defineSite } from "@micacms/core";         // where it lives now

import { fileSystemSource } from "@micacms/model/node"; // still works
import { fileSystemSource } from "@micacms/core/node";  // where it lives now
```

Switch your dependency to `@micacms/core` before the re-export is retired.
