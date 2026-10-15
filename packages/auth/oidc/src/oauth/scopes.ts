/** The scopes an agent can ask for, and what each one means to the person who allows it. */

import { AGENT_SCOPES } from "@micacms/runtime";

export const SCOPE_WORDS: Record<string, string> = {
  [AGENT_SCOPES.read]: "Read the content model and all content.",
  [AGENT_SCOPES.write]: "Save drafts: change entries and settings, upload files and discard drafts.",
  [AGENT_SCOPES.publish]: "Publish drafts to the website.",
};

/** The scopes this Mica grants: publish only when the operator allows it. */
export function offeredScopes(publish: boolean): string[] {
  return [AGENT_SCOPES.read, AGENT_SCOPES.write, ...(publish ? [AGENT_SCOPES.publish] : [])];
}

/** The scopes an agent gets from what it asked: the known ones only, and read and write when it asked for none. */
export function grantedScopes(requested: string | undefined, offered: string[]): string[] {
  const asked = (requested ?? "").split(/\s+/).filter((scope) => offered.includes(scope));
  return asked.length > 0 ? [...new Set(asked)] : [AGENT_SCOPES.read, AGENT_SCOPES.write];
}
