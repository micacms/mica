/** What the System page says about this deployment that only the image knows. */

import type { OperationalInfo } from "@micacms/runtime";

import type { SelfHostedConfig } from "./config.js";

export function operationalInfo(
  config: Pick<SelfHostedConfig, "dataDir" | "MICA_SESSION_TTL_HOURS" | "MICA_SESSION_IDLE_HOURS">,
  auth: { label: string; admission: string },
): OperationalInfo {
  return {
    auth: auth.label,
    admission: auth.admission,
    dataDir: config.dataDir,
    facts: [
      {
        label: "Session lifetime",
        value: `${config.MICA_SESSION_TTL_HOURS} h, idle out after ${config.MICA_SESSION_IDLE_HOURS} h`,
      },
    ],
  };
}
