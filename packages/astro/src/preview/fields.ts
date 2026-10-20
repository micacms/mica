/**
 * The fields that each element of an Astro template reads, for the live
 * preview. A date, a number or an option reaches the page formatted, looked up
 * or compared, so its value cannot carry a marker. The template can say instead
 * where it shows it: before Astro compiles a `.astro` file in the preview's dev
 * server, this adds `data-mica-fields` to each element whose expressions read a
 * field. The file on disk and a build stay as they are.
 *
 * A small dataflow over Astro's syntax tree:
 * - `x.data` is the data of an entry; a member access on a field extends its path (`venue.name`);
 * - destructuring and renaming follow the path (`const { startsAt: start } = event.data`);
 * - a computed value keeps the fields it comes from (`const badge = dateBadge(event.data.startsAt)`);
 * - in `items.map((item) => …)`, `item` holds what `items` holds;
 * - `await getSomething()` without a field among its arguments is a document, such as a singleton (`settings.phone`).
 *
 * A component gets its values as props, so it cannot know which fields they are. The
 * element that uses it can: `<TagList tags={tags} />` reads `tags`. That element gets
 * the attribute like any other, and each root element of a template puts the fields
 * that it received first (`Astro.props["data-mica-fields"]`), before its own.
 *
 * The page's script then gives each such element to the nearest document whose model has the field.
 */

import { FIELDS_ATTRIBUTE } from "./markers.js";

/** The parts of an ESTree or JSX node that the analysis reads. */
interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

/** What an expression holds: the value of the field at `exact` (`""` is the whole data), or a value computed from `fields`. */
interface Value {
  exact?: string;
  fields: Set<string>;
}

type Scope = Map<string, Value>;

/** The `parse` of `@astrojs/compiler-rs`. */
export type ParseAstro = (source: string) => { ast: unknown; diagnostics?: ReadonlyArray<{ severity?: string }> };

/** Elements that never show a field. */
const SKIPPED = new Set(["script", "style", "slot", "Fragment"]);

const NOTHING: Value = { fields: new Set() };

const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";

/** Every field that a value reads. The whole data is no field. */
function fieldsOf(value: Value): Set<string> {
  return value.exact ? new Set([...value.fields, value.exact]) : value.fields;
}

function union(...values: Value[]): Value {
  return { fields: new Set(values.flatMap((value) => [...fieldsOf(value)])) };
}

const join = (path: string, key: string): string => (path ? `${path}.${key}` : key);

/** `value.key`. `data` is the data of an entry; a numeric index keeps the field of the list. */
function member(value: Value, key: string | number | null): Value {
  if (key === "data") return { exact: "", fields: new Set() };
  if (value.exact !== undefined && typeof key === "number") return value;
  if (value.exact !== undefined && typeof key === "string") return { exact: join(value.exact, key), fields: value.fields };
  return { fields: fieldsOf(value) };
}

function propertyKey(node: AstNode): string | number | null {
  const property = node["property"];
  if (!isNode(property)) return null;
  if (!node["computed"] && property.type === "Identifier") return property["name"] as string;
  if (property.type === "Literal") return typeof property["value"] === "number" || typeof property["value"] === "string" ? (property["value"] as string | number) : null;
  return null;
}

/** What an expression holds. JSX inside it is the walker's: it holds nothing here. */
function evaluate(node: unknown, scope: Scope): Value {
  if (!isNode(node)) return NOTHING;
  switch (node.type) {
    case "Identifier":
      return scope.get(node["name"] as string) ?? NOTHING;
    case "MemberExpression":
      return member(evaluate(node["object"], scope), propertyKey(node));
    case "ChainExpression":
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSNonNullExpression":
      return evaluate(node["expression"], scope);
    case "AwaitExpression": {
      // A fetched document without a field among the arguments: a singleton, or an entry, read as data.
      const value = evaluate(node["argument"], scope);
      return value.exact === undefined && value.fields.size === 0 && isNode(node["argument"]) && node["argument"].type === "CallExpression"
        ? { exact: "", fields: new Set() }
        : value;
    }
    case "CallExpression": {
      const callee = node["callee"];
      const target = isNode(callee) && callee.type === "MemberExpression" ? evaluate(callee["object"], scope) : NOTHING;
      const parts = [target, ...(node["arguments"] as unknown[]).map((argument) => callbackValue(argument, target, scope))];
      return union(...parts);
    }
    // What the page shows: not a condition, not the key of an object.
    case "LogicalExpression":
      return node["operator"] === "&&" ? evaluate(node["right"], scope) : union(evaluate(node["left"], scope), evaluate(node["right"], scope));
    case "ConditionalExpression":
      return union(evaluate(node["consequent"], scope), evaluate(node["alternate"], scope));
    case "Property":
      return node["computed"] ? union(evaluate(node["key"], scope), evaluate(node["value"], scope)) : evaluate(node["value"], scope);
    case "ArrowFunctionExpression":
    case "FunctionExpression":
    case "JSXElement":
    case "JSXFragment":
      return NOTHING;
    default:
      return union(...children(node).map((child) => evaluate(child, scope)));
  }
}

/** An argument of a call: a callback such as the one of `items.map` returns what its body computes from an item. */
function callbackValue(argument: unknown, items: Value, scope: Scope): Value {
  if (!isNode(argument) || (argument.type !== "ArrowFunctionExpression" && argument.type !== "FunctionExpression")) return evaluate(argument, scope);
  const inner = withParameters(argument, items, scope);
  const body = argument["body"];
  return isNode(body) && body.type !== "BlockStatement" ? evaluate(body, inner) : NOTHING;
}

/** A callback's scope: its parameters hold an item of `items`. */
function withParameters(callback: AstNode, items: Value, scope: Scope): Scope {
  const inner = new Map(scope);
  const [first] = (callback["params"] as unknown[]) ?? [];
  if (first) bind(first, items, inner);
  return inner;
}

/** Binds the names of a declaration or a parameter: `x`, `{ a, b: c }`, `[first]`, with defaults and rest. */
function bind(pattern: unknown, value: Value, scope: Scope): void {
  if (!isNode(pattern)) return;
  switch (pattern.type) {
    case "Identifier":
      scope.set(pattern["name"] as string, value);
      return;
    case "AssignmentPattern":
      bind(pattern["left"], value, scope);
      return;
    case "RestElement":
      bind(pattern["argument"], { fields: fieldsOf(value) }, scope);
      return;
    case "ArrayPattern":
      for (const element of (pattern["elements"] as unknown[]) ?? []) bind(element, value, scope);
      return;
    case "ObjectPattern":
      for (const property of (pattern["properties"] as unknown[]) ?? []) {
        if (!isNode(property)) continue;
        if (property.type === "RestElement") {
          bind(property, value, scope);
          continue;
        }
        const key = property["key"];
        const name = isNode(key) && !property["computed"] ? (key.type === "Identifier" ? key["name"] : key["value"]) : null;
        bind(property["value"], typeof name === "string" ? member(value, name) : { fields: fieldsOf(value) }, scope);
      }
  }
}

/** The declarations of a list of statements, in order. */
function declare(statements: unknown[], scope: Scope): void {
  for (const statement of statements) {
    if (!isNode(statement) || statement.type !== "VariableDeclaration") continue;
    for (const declarator of (statement["declarations"] as unknown[]) ?? []) {
      if (isNode(declarator)) bind(declarator["id"], evaluate(declarator["init"], scope), scope);
    }
  }
}

function children(node: AstNode): unknown[] {
  const found: unknown[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    if (Array.isArray(value)) found.push(...value.filter(isNode));
    else if (isNode(value)) found.push(value);
  }
  return found;
}

/** The name of an element as written: `time`, `Image`, `Astro.Foo`. */
const elementName = (source: string, element: AstNode): string => /^[^\s/>{]+/.exec(source.slice(element.start + 1))?.[0] ?? "";

/** Where the attribute of an element goes: after its name. Null for an element that shows no field, or that has the attribute already. */
function attributePosition(element: AstNode, source: string): number | null {
  const opening = element["openingElement"];
  const name = elementName(source, element);
  if (!isNode(opening) || !name || SKIPPED.has(name)) return null;
  const attributes = ((opening["attributes"] as unknown[]) ?? []).filter(isNode);
  if (attributes.some((attribute) => source.slice(attribute.start, attribute.end).startsWith(FIELDS_ATTRIBUTE))) return null;
  return element.start + 1 + name.length;
}

/** The root elements of a template: also those that a top-level expression renders, such as `{items.length > 0 && <ul>…</ul>}`. */
function rootElements(node: unknown): AstNode[] {
  if (!isNode(node)) return [];
  if (node.type === "JSXElement") return [node];
  return children(node).flatMap(rootElements);
}

/** Collects, for each element, where its attribute goes and the fields that its own expressions read. */
function walk(node: unknown, scope: Scope, source: string, found: Map<number, Set<string>>): void {
  if (!isNode(node)) return;

  if (node.type === "JSXElement") {
    const opening = node["openingElement"];
    const at = attributePosition(node, source);
    if (isNode(opening) && at !== null) {
      const attributes = ((opening["attributes"] as unknown[]) ?? []).filter(isNode);
      const values = [
        ...attributes.map((attribute) => evaluate(attribute.type === "JSXSpreadAttribute" ? attribute["argument"] : attribute["value"], scope)),
        ...((node["children"] as unknown[]) ?? []).filter((child) => isNode(child) && child.type === "JSXExpressionContainer").map((child) => evaluate(child, scope)),
      ];
      const fields = fieldsOf(union(...values));
      if (fields.size > 0) found.set(at, fields);
    }
  }

  // A callback holds an item of what its call is on; a block declares names before it uses them.
  if (node.type === "CallExpression") {
    const callee = node["callee"];
    const items = isNode(callee) && callee.type === "MemberExpression" ? evaluate(callee["object"], scope) : NOTHING;
    walk(callee, scope, source, found);
    for (const argument of (node["arguments"] as unknown[]) ?? []) {
      if (isNode(argument) && (argument.type === "ArrowFunctionExpression" || argument.type === "FunctionExpression")) {
        walk(argument["body"], withParameters(argument, items, scope), source, found);
      } else walk(argument, scope, source, found);
    }
    return;
  }
  if (node.type === "BlockStatement") {
    const inner = new Map(scope);
    const statements = (node["body"] as unknown[]) ?? [];
    declare(statements, inner);
    for (const statement of statements) walk(statement, inner, source, found);
    return;
  }

  for (const child of children(node)) walk(child, scope, source, found);
}

/** The source of a `.astro` file with `data-mica-fields` on each element that shows a field; the same source when none does. */
export function annotateFields(source: string, parse: ParseAstro): string {
  try {
    return annotate(source, parse);
  } catch {
    // The preview must never break a page: without the analysis, the template is as written.
    return source;
  }
}

function annotate(source: string, parse: ParseAstro): string {
  const result = parse(source);
  // A file with an error: Astro reports it, not the preview.
  if (result.diagnostics?.some((diagnostic) => diagnostic.severity === "error")) return source;
  const ast = result.ast;
  if (!isNode(ast)) return source;

  const scope: Scope = new Map();
  const frontmatter = ast["frontmatter"];
  const program = isNode(frontmatter) ? frontmatter["program"] : undefined;
  if (isNode(program)) declare((program["body"] as unknown[]) ?? [], scope);

  const found = new Map<number, Set<string>>();
  const body = ((ast["body"] as unknown[]) ?? []).filter(isNode);
  for (const node of body) walk(node, scope, source, found);

  // The root elements of a component: the fields of the element that uses it first.
  const roots = new Set(body.flatMap(rootElements).map((node) => attributePosition(node, source)).filter((at) => at !== null));
  if (found.size === 0 && roots.size === 0) return source;

  // From the end, so that each position stays right.
  let annotated = source;
  for (const at of [...new Set([...found.keys(), ...roots])].sort((a, b) => b - a)) {
    const own = [...(found.get(at) ?? [])].join(" ");
    const attribute = roots.has(at)
      ? `${FIELDS_ATTRIBUTE}={[Astro.props[${JSON.stringify(FIELDS_ATTRIBUTE)}], ${JSON.stringify(own)}].filter(Boolean).join(" ") || undefined}`
      : `${FIELDS_ATTRIBUTE}="${own.replaceAll('"', "&quot;")}"`;
    annotated = `${annotated.slice(0, at)} ${attribute}${annotated.slice(at)}`;
  }
  return annotated;
}
