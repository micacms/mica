/** The fields that each element of a template reads, for the live preview: found with Astro's own parser. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parse } from "@astrojs/compiler-rs";

import { annotateFields } from "../src/preview/fields.js";

/** Each annotated element of a template, as `tag: fields`; a root element, which puts the fields it receives first, as `tag: ↑ fields`. */
function fieldsIn(template: string): string[] {
  const annotated = annotateFields(template, parse);
  return [...annotated.matchAll(/<([A-Za-z][\w.]*) data-mica-fields=(?:"([^"]*)"|\{\[Astro\.props\["data-mica-fields"\], "([^"]*)"\])/g)].map((match) =>
    match[2] !== undefined ? `${match[1]}: ${match[2]}` : `${match[1]}: ↑ ${match[3]}`.trimEnd(),
  );
}

describe("the fields of a template's elements", () => {
  it("follows destructuring, renaming and member paths of an entry's data", () => {
    const template = `---
const { event } = Astro.props;
const { startsAt, venue: place, title } = event.data;
---
<article><time datetime={startsAt}>{format(startsAt)}</time><p>{place.name}</p><h1>{title}</h1><p>{event.data.location?.city}</p></article>`;
    assert.deepEqual(fieldsIn(template), ["article: ↑", "time: startsAt", "p: venue.name", "h1: title", "p: location.city"]);
  });

  it("keeps the fields of a computed value, and of the items of a loop", () => {
    const template = `---
const events = await getCollection("events");
---
<ul>{events.map((event) => {
  const badge = dateBadge(event.data.startsAt);
  return <li><span>{badge.day}</span>{event.data.tags.map((tag) => <b>{tag}</b>)}</li>;
})}</ul>`;
    assert.deepEqual(fieldsIn(template), ["ul: ↑", "li: tags", "span: startsAt", "b: tags"]);
  });

  it("reads a fetched document as data: a singleton's fields", () => {
    const template = `---
const settings = await getSiteSettings();
---
<footer><a href={\`tel:\${settings.phone}\`}>{settings.phone}</a><Image {...settings.logo} /></footer>`;
    assert.deepEqual(fieldsIn(template), ["footer: ↑", "a: phone", "Image: logo"]);
  });

  it("counts what the page shows: not a condition, not the key of an object", () => {
    const template = `---
const { featured, title, startsAt } = entry.data;
const card = { heading: title };
---
<div>{featured && <p>{card.heading}</p>}{startsAt ? "Soon" : "Later"}</div>`;
    assert.deepEqual(fieldsIn(template), ["div: ↑", "p: title"]);
  });

  it("leaves scripts, styles and an element that has the attribute as they are, and finds positions after other scripts", () => {
    const template = `---
const { title } = entry.data;
---
<p>Grüezi 🙂</p><style>p { color: red }</style><h2 data-mica-fields="other">{title}</h2><h3>{title}</h3>`;
    assert.deepEqual(fieldsIn(template), ["p: ↑", "h2: other", "h3: ↑ title"]);
    assert.match(annotateFields(template, parse), /undefined\}>Grüezi 🙂<\/p><style>/u);
  });

  it("passes the fields that a component receives on to its root elements, before its own", () => {
    const template = `---
const { tags } = Astro.props;
const labels = await getLabels();
---
{tags.length > 0 && (<ul aria-label={labels.general.tags}>{tags.map((tag) => <li>{tag}</li>)}</ul>)}`;
    assert.deepEqual(fieldsIn(template), ["ul: ↑ general.tags"]);
  });

  it("leaves a template that does not parse exactly as it is", () => {
    assert.equal(annotateFields("<p>{</p", parse), "<p>{</p");
  });
});
