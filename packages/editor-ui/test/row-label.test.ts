/** The title of a repeater row: its `itemLabel` field, a relation by its entry's title. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { boolean, relation, repeater, text } from "@micacms/core/internal";

import { rowLabel, rowLabelRelation } from "../src/lib/row-label.js";

const titles = new Map([["taetsch", "Tätsch"]]);
const titleOf = (id: string) => titles.get(id);

describe("rowLabel", () => {
  it("shows the text of the itemLabel field", () => {
    const field = repeater({ itemLabel: "heading", fields: { heading: text() } });
    assert.equal(rowLabel(field, { heading: "  Opening hours " }, 0), "Opening hours");
  });

  it("shows a single relation by the title of its entry, else by its id", () => {
    const field = repeater({
      itemLabel: "waypoint",
      addLabel: "Add waypoint",
      fields: { waypoint: relation({ collection: "waypoints" }), highlight: boolean() },
    });
    assert.equal(rowLabelRelation(field), "waypoints");
    assert.equal(rowLabel(field, { waypoint: "taetsch" }, 0, titleOf), "Tätsch");
    assert.equal(rowLabel(field, { waypoint: "albert-heim-huette" }, 1, titleOf), "albert-heim-huette");
    assert.equal(rowLabel(field, { waypoint: null }, 2, titleOf), "Waypoint 3");
  });

  it("numbers the rows without an itemLabel", () => {
    const field = repeater({ fields: { heading: text() } });
    assert.equal(rowLabelRelation(field), undefined);
    assert.equal(rowLabel(field, { heading: "Ignored" }, 1), "Item 2");
  });

  it("does not take a list of relations as the title", () => {
    const field = repeater({ itemLabel: "people", fields: { people: relation({ collection: "team", multiple: true }) } });
    assert.equal(rowLabelRelation(field), undefined);
    assert.equal(rowLabel(field, { people: ["anna"] }, 0, titleOf), "Item 1");
  });
});
