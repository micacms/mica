/**
 * What every owner policy must do when it publishes (#136).
 *
 * The local editor's developer policy and the self-hosted managed workspace
 * each run this suite against a real Git remote: `apps/local-editor/test` and
 * `apps/self-hosted/test` give it a subject. What only one policy does, such as
 * a sync or a conflict, stays in that policy's own tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collection, defineSite, id, text } from "@micacms/core/internal";

/** The model of the suite: the subject builds its staging service with it. */
export const conformanceModel = defineSite({
  collections: {
    posts: collection({
      label: "Posts",
      fields: { title: text({ label: "Title", required: true }), id: id({ from: "title" }) },
    }),
  },
});

/** The files of the repository before each test, relative to its top. The content root is `content`. */
export const conformanceSeed: Record<string, string> = {
  "content/.mica/schema.json": '{"protocolVersion":1}\n',
  "content/posts/a/index.json": '{"title":"A","id":"a"}\n',
  "content/posts/b/index.json": '{"title":"B","id":"b"}\n',
  "src/pages/index.astro": "---\n---\n",
};

interface Result {
  state: "published" | "committed-pending-push";
  revision: string | null;
}

/** The part of the staging service that the suite uses. */
interface Staging {
  status(): Promise<{ changes: Array<{ path: string; revision?: string | null }> }>;
  publish(input: { message: string; paths: Record<string, string | null>; author?: { name: string; email: string } }): Promise<Result>;
  push(): Promise<Result>;
}

export interface PublishSubject {
  service: Staging;
  /** Saves a draft: writes a file under the content root, as the editor does. */
  write(path: string, contents: string): void;
  /** The newest commit of the working tree: its paths from the top of the repository, its author, and the count. */
  lastCommit(): { paths: string[]; author: string; count: number };
  /** The commit at the remote branch. */
  remoteHead(): string;
  /** Makes the remote unreachable, and returns the function that brings it back. */
  cutRemote(): () => void;
  /** The author that this policy writes for `editor`, as `Name <email>`. */
  expectedAuthor(editor: { name: string; email: string }): string;
}

const editor = { name: "Erika Editor", email: "erika@example.com" };

/** The reviewed paths of the pending changes under `prefix`, with their revisions, as the Publish page sends them. */
async function review(service: Staging, prefix: string): Promise<Record<string, string | null>> {
  const { changes } = await service.status();
  return Object.fromEntries(changes.filter((change) => change.path.startsWith(prefix)).map((change) => [change.path, change.revision ?? null]));
}

export function describePublishConformance(owner: string, makeSubject: () => Promise<PublishSubject>): void {
  describe(`publish conformance: ${owner}`, () => {
    it("makes one commit of exactly the reviewed paths, and sends it", async () => {
      const subject = await makeSubject();
      const before = subject.lastCommit().count;
      subject.write("posts/a/index.json", '{"title":"A, reviewed","id":"a"}\n');
      const paths = await review(subject.service, "posts/a/");
      subject.write("posts/b/index.json", '{"title":"B, saved later","id":"b"}\n');

      const result = await subject.service.publish({ message: "Edit A", paths, author: editor });

      assert.equal(result.state, "published");
      const commit = subject.lastCommit();
      assert.equal(commit.count, before + 1);
      assert.deepEqual(commit.paths, ["content/posts/a/index.json"]);
      assert.equal(subject.remoteHead(), result.revision);
      assert.deepEqual((await subject.service.status()).changes.map((change) => change.path), ["posts/b/index.json"]);
    });

    it("writes the author that the policy names for the editor", async () => {
      const subject = await makeSubject();
      subject.write("posts/a/index.json", '{"title":"A, by Erika","id":"a"}\n');

      await subject.service.publish({ message: "Edit A", paths: await review(subject.service, "posts/"), author: editor });

      assert.equal(subject.lastCommit().author, subject.expectedAuthor(editor));
    });

    it("keeps the commit when the push fails, and a retry sends it without a second commit", async () => {
      const subject = await makeSubject();
      const before = subject.lastCommit().count;
      subject.write("posts/a/index.json", '{"title":"A, offline","id":"a"}\n');
      const restore = subject.cutRemote();

      let pending: Result;
      try {
        pending = await subject.service.publish({ message: "Edit A", paths: await review(subject.service, "posts/"), author: editor });
      } finally {
        restore();
      }
      assert.equal(pending.state, "committed-pending-push");
      assert.ok(pending.revision);
      assert.equal(subject.lastCommit().count, before + 1);
      assert.deepEqual((await subject.service.status()).changes, []);

      const retried = await subject.service.push();
      assert.equal(retried.state, "published");
      assert.equal(retried.revision, pending.revision);
      assert.equal(subject.lastCommit().count, before + 1);
      assert.equal(subject.remoteHead(), pending.revision);
    });

    it("refuses a path outside the content root, and commits nothing", async () => {
      const subject = await makeSubject();
      const before = subject.lastCommit().count;

      await assert.rejects(subject.service.publish({ message: "Edit the page", paths: { "../src/pages/index.astro": null }, author: editor }));

      assert.equal(subject.lastCommit().count, before);
    });

    it("refuses a draft that was saved again after the review, and commits nothing", async () => {
      const subject = await makeSubject();
      const before = subject.lastCommit().count;
      subject.write("posts/a/index.json", '{"title":"A, reviewed","id":"a"}\n');
      const paths = await review(subject.service, "posts/");
      subject.write("posts/a/index.json", '{"title":"A, saved again","id":"a"}\n');

      await assert.rejects(subject.service.publish({ message: "Edit A", paths, author: editor }));

      assert.equal(subject.lastCommit().count, before);
    });
  });
}
