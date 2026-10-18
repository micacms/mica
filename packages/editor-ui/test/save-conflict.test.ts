/** The 409 of a save: their version, "Keep mine" and "Use theirs" (#240). Against a fake API, as the server answers. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError } from "../src/api.js";
import { useSaveConflict, type SaveBasis, type SavedVersion } from "../src/composables/useSaveConflict.js";

/** One document on a fake server: a write at an old revision is a conflict, unless it keeps its own on purpose. */
function fakeServer(data: Record<string, unknown>) {
  let saved: SavedVersion | null = { data, revision: "r1" };
  let next = 2;
  const sent: SaveBasis[] = [];
  return {
    sent,
    read: async (): Promise<SavedVersion> => {
      if (!saved) throw new ApiError(404, "not_found", "There is no such entry.");
      return structuredClone(saved);
    },
    write: async (values: Record<string, unknown>, basis: SaveBasis): Promise<{ revision: string }> => {
      sent.push(basis);
      if (basis.revision !== (saved?.revision ?? null)) throw new ApiError(409, "conflict", "Somebody saved this since you opened it.");
      saved = { data: values, revision: `r${next++}` };
      return { revision: `r${next - 1}` };
    },
    /** A colleague saves in another tab. */
    colleague(values: Record<string, unknown>): void {
      saved = { data: values, revision: `r${next++}` };
    },
    /** A colleague deletes it, or moves it to another URL. */
    remove(): void {
      saved = null;
    },
  };
}

describe("useSaveConflict", () => {
  it("lets a save at the opened revision through, and shows nothing", async () => {
    const server = fakeServer({ title: "Old" });
    const conflict = useSaveConflict(server.read);
    const outcome = await conflict.run("r1", () => server.write({ title: "Mine" }, conflict.basis("r1")));
    assert.deepEqual(outcome, { kind: "done", result: { revision: "r2" } });
    assert.equal(conflict.state.value, "none");
    assert.deepEqual(server.sent, [{ revision: "r1", keepMine: false }]);
  });

  it("shows their version when a colleague saved since the form opened", async () => {
    const server = fakeServer({ title: "Old" });
    const conflict = useSaveConflict(server.read);
    server.colleague({ title: "Theirs" });
    const outcome = await conflict.run("r1", () => server.write({ title: "Mine" }, conflict.basis("r1")));
    assert.deepEqual(outcome, { kind: "conflict" });
    assert.equal(conflict.state.value, "loaded");
    assert.deepEqual(conflict.theirs.value, { data: { title: "Theirs" }, revision: "r2" });
  });

  it("saves over their version with Keep mine, at their revision", async () => {
    const server = fakeServer({ title: "Old" });
    const conflict = useSaveConflict(server.read);
    server.colleague({ title: "Theirs" });
    await conflict.run("r1", () => server.write({ title: "Mine" }, conflict.basis("r1")));

    const basis = conflict.basis("r1", true);
    assert.deepEqual(basis, { revision: "r2", keepMine: true });
    const outcome = await conflict.run("r1", () => server.write({ title: "Mine" }, basis));
    assert.equal(outcome.kind, "done");
    assert.equal(conflict.state.value, "none");
    assert.deepEqual(await server.read(), { data: { title: "Mine" }, revision: "r3" });
  });

  it("does not keep mine over a version that it does not show", async () => {
    const server = fakeServer({ title: "Old" });
    const conflict = useSaveConflict(server.read);
    assert.deepEqual(conflict.basis("r1", true), { revision: "r1", keepMine: false });

    server.remove();
    await conflict.run("r1", () => server.write({ title: "Mine" }, conflict.basis("r1")));
    assert.equal(conflict.state.value, "missing");
    assert.deepEqual(conflict.basis("r1", true), { revision: "r1", keepMine: false });
  });

  it("says that their version is missing when it cannot be read", async () => {
    const server = fakeServer({ title: "Old" });
    const conflict = useSaveConflict(server.read);
    server.remove();
    const outcome = await conflict.run("r1", () => server.write({ title: "Mine" }, conflict.basis("r1")));
    assert.deepEqual(outcome, { kind: "conflict" });
    assert.equal(conflict.state.value, "missing");
    assert.equal(conflict.theirs.value, null);
  });

  it("refuses with the server's words when the document is as the form opened it", async () => {
    const server = fakeServer({ title: "Old" });
    const conflict = useSaveConflict(server.read);
    // An entry whose links were to follow changed: this one did not.
    const outcome = await conflict.run("r1", async () => {
      throw new ApiError(409, "conflict", "A page that links here changed since you opened it.");
    });
    assert.deepEqual(outcome, { kind: "refused", message: "A page that links here changed since you opened it." });
    assert.equal(conflict.state.value, "none");
  });

  it("throws any other failure, and shows no conflict", async () => {
    const server = fakeServer({ title: "Old" });
    const conflict = useSaveConflict(server.read);
    await assert.rejects(
      conflict.run("r1", async () => {
        throw new ApiError(422, "invalid", "Some fields need attention.");
      }),
      (error: unknown) => error instanceof ApiError && error.status === 422,
    );
    assert.equal(conflict.state.value, "none");
  });

  it("goes back to none when Use theirs opens their version, and ignores the answer of a load that came late", async () => {
    const server = fakeServer({ title: "Old" });
    let answer: (version: SavedVersion) => void = () => {};
    const conflict = useSaveConflict(() => new Promise<SavedVersion>((resolve) => (answer = resolve)));
    server.colleague({ title: "Theirs" });

    const shown = conflict.show("r1");
    assert.equal(conflict.state.value, "loading");
    conflict.clear();
    answer(await server.read());
    assert.equal(await shown, true);
    assert.equal(conflict.state.value, "none");
    assert.equal(conflict.theirs.value, null);
  });
});
