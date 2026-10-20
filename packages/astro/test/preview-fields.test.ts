/** The fields that each element of a template reads, for the live preview: found with Astro's own parser. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parse } from "@astrojs/compiler-rs";

import { annotateFields } from "../src/preview/fields.js";

/**
 * Each annotated element of a template, as `tag: fields`; a root element, which puts the fields it receives first, as
 * `tag: ↑ fields`. The row of a loop shows as `[index]`.
 */
function fieldsIn(template: string): string[] {
  const annotated = annotateFields(template, parse);
  const attribute = /<([A-Za-z][\w.]*) data-mica-fields=(?:"([^"]*)"|\{`([^`]*)`\}|\{\[Astro\.props\["data-mica-fields"\], (?:"([^"]*)"|`([^`]*)`)\])/g;
  return [...annotated.matchAll(attribute)].map((match) => {
    const [own, root] = [match[2] ?? match[3], match[4] ?? match[5]].map((text) => text?.replace(/\$\{(\w+)\}/g, "[$1]"));
    return own !== undefined ? `${match[1]}: ${own}` : `${match[1]}: ↑ ${root}`.trimEnd();
  });
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
    assert.deepEqual(fieldsIn(template), ["ul: ↑", "li: tags", "span: startsAt", "b: tags.[__micaRow0]"]);
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

  it("counts a field in the key of a lookup, such as a layout's class", () => {
    const template = `---
const { layout, title } = entry.data;
---
<section class={LAYOUTS[layout ?? "full"]}><h2>{title}</h2></section>`;
    assert.deepEqual(fieldsIn(template), ["section: ↑ layout", "h2: title"]);
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

  it("names the row of a loop on a field with the callback's index, and gives the callback one if it has none", () => {
    const template = `---
const { sections } = page.data;
const settings = await getSiteSettings();
---
<div>{sections.map((section) => <section><h2>{section.heading}</h2><time>{format(section.date)}</time></section>)}
<ul>{settings.social.map((link, index) => <li><a href={link.url}>{icon(link.platform)}</a></li>)}</ul>
<ol>{sections.filter(visible).map((section) => <li>{section.heading}</li>)}</ol></div>`;
    assert.deepEqual(fieldsIn(template), [
      "div: ↑ sections",
      "h2: sections.[__micaRow0].heading",
      "time: sections.[__micaRow0].date",
      "ul: social",
      "a: social.[index].url social.[index].platform",
      "ol: sections",
      "li: sections",
    ]);
    const annotated = annotateFields(template, parse);
    assert.match(annotated, /sections\.map\(\(section, __micaRow0\) =>/);
    // After a filter, the index is not the row: that callback stays as it was.
    assert.match(annotated, /\.map\(\(section\) => <li data-mica-fields="sections">/);
    assert.equal(parse(annotated).diagnostics?.some((diagnostic) => diagnostic.severity === "error"), false);
  });

  it("names the rows of nested loops, adds parentheses where a callback has none, and names no row that an inner name hides", () => {
    const template = `---
const navigation = await getNavigation();
---
<nav>{navigation.main.map(item => <a href={item.href}>{item.children.map((child, i) => <b>{child.label}</b>)}</a>)}
{navigation.main.map((item, i) => item.children.map((child, i) => <i>{child.label}</i>))}
{navigation.main.map((item) => item.label).join(", ")}
{navigation.main.map((item, i) => item.children.slice(0, 2).map((child, i) => <u>{item.label}</u>))}
{navigation.main.map((item, i) => { if (item.label) { const i = 0; return <s>{item.label}</s>; } })}
{navigation.main.map((...items) => <em>{items[0].label}</em>)}</nav>`;
    assert.deepEqual(fieldsIn(template), [
      "nav: ↑ main main.children main.label",
      "a: main.[__micaRow0].href main.[__micaRow0].children",
      "b: main.[__micaRow0].children.[i].label",
      "i: main.children.label",
      "u: main.label",
      "s: main.label",
      "em: main",
    ]);
    const annotated = annotateFields(template, parse);
    assert.match(annotated, /navigation\.main\.map\(\(item, __micaRow0\) =>/);
    // No element uses the row of the last loop: it gets no parameter.
    assert.match(annotated, /navigation\.main\.map\(\(item\) => item\.label\)/);
    assert.equal(parse(annotated).diagnostics?.some((diagnostic) => diagnostic.severity === "error"), false);
  });

  it("leaves a template that does not parse exactly as it is", () => {
    assert.equal(annotateFields("<p>{</p", parse), "<p>{</p");
  });
});
