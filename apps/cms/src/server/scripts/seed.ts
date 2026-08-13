/**
 * Seeds demo content so a fresh checkout has something to look at.
 *
 *   pnpm --filter @micacms/cms seed
 *
 * Idempotent: entries are keyed by slug, so re-running updates rather than
 * duplicates. Refuses to touch a database that already holds other content
 * unless `--force` is given.
 */

import { entryTitle, resolveSlugField, slugify, validateFields } from "@micacms/model";

import { loadConfig } from "../config.js";
import { openDatabase } from "../db/index.js";
import { createLogger } from "../lib/logger.js";
import { createEntryRepository } from "../repositories/entries.js";
import { createGlobalRepository } from "../repositories/globals.js";
import { createUserRepository } from "../repositories/users.js";
import { loadSchema } from "../schema.js";
import { hashPassword } from "../services/password.js";

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "mica-demo-password";

const pages = [
  {
    title: "About us",
    intro: "An independent consultancy for owner-led businesses, working out of Zürich since 2009.",
    body:
      "<p>We are a small team advising small teams. Most of our clients employ between ten and " +
      "two hundred people, and most of them call us when something has outgrown the way it used " +
      "to be done.</p>" +
      "<h2>How we work</h2>" +
      "<p>Every engagement starts with a week of listening. We would rather spend an afternoon " +
      "understanding how the work actually flows than a month correcting an assumption.</p>",
  },
  {
    title: "Services",
    intro: "Strategy, operations and digital projects — scoped to what a small team can deliver.",
    body:
      "<p>From a two-day process review to a year-long transformation, the same people stay on " +
      "the engagement from first workshop to handover.</p>" +
      "<h2>What we are asked for most</h2>" +
      "<ul>" +
      "<li>Operations and process reviews</li>" +
      "<li>Software selection and vendor negotiation</li>" +
      "<li>Reporting and management dashboards</li>" +
      "<li>Succession and reorganisation support</li>" +
      "</ul>",
  },
  {
    title: "Contact",
    intro: "Come by the office, or send a message.",
    body: "<p>Löwenstrasse 24, 8001 Zürich. We answer the phone between 08:00 and 17:00.</p>",
  },
];

const team = [
  { name: "Anna Wyss", role: "Managing partner", bio: "Founded the practice in 2009 after ten years in industry. Leads client work and the occasional workshop." },
  { name: "Thomas Brunner", role: "Senior consultant", bio: "Operations and process work. Spends most weeks on client sites rather than in the office." },
  { name: "Sofia Rossi", role: "Consultant, data", bio: "Joined from a Basel software firm. Builds the reporting that nobody else wants to build." },
];

const projects = [
  {
    title: "Order-to-cash review",
    year: 2025,
    category: "commercial",
    description: "<p>An end-to-end review of quoting, delivery and invoicing for a family-owned wholesaler.</p>",
    location: { address: "Industriestrasse 14", city: "Winterthur", postalCode: "8404", position: { lat: 47.5056, lng: 8.7241 } },
    facts: [
      { label: "Duration", value: "4 months" },
      { label: "Team", value: "3 consultants" },
      { label: "Lead time", value: "−35%" },
    ],
    featured: true,
  },
  {
    title: "ERP selection for a regional retailer",
    year: 2025,
    category: "commercial",
    description: "<p>Requirements, shortlist and vendor negotiation for a twelve-branch retailer replacing a system it had outgrown.</p>",
    location: { address: "Bahnhofstrasse 7", city: "Zug", postalCode: "6300", position: { lat: 47.1735, lng: 8.5155 } },
    facts: [
      { label: "Vendors assessed", value: "9" },
      { label: "Licence cost", value: "−22%" },
    ],
    featured: true,
  },
  {
    title: "Service desk consolidation",
    year: 2024,
    category: "public",
    description: "<p>Merging three separate support teams in a cantonal office into one desk, without adding headcount.</p>",
    location: { address: "Amtshausgasse 3", city: "Aarau", postalCode: "5000", position: { lat: 47.3915, lng: 8.0455 } },
    facts: [{ label: "Tickets per month", value: "2 400" }],
    featured: false,
  },
];

const news = [
  {
    title: "Our 2026 SME operations benchmark",
    publishDate: "2026-04-21",
    excerpt: "We asked 120 owner-led businesses where their week actually goes. The answers were not flattering.",
    body: "<p>The full report is free to read, and the underlying questionnaire is yours to reuse.</p>",
  },
  {
    title: "We are hiring a junior consultant",
    publishDate: "2026-07-15",
    excerpt: "A place for someone who likes spreadsheets and shop floors in equal measure.",
    body: "<p>Applications are open until the end of September. Come and see the office first.</p>",
  },
];

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const config = loadConfig();
  const logger = createLogger({ level: "info", pretty: true });
  // The same model the server will serve, from the same place — seeding against
  // a different schema than the CMS runs would produce entries it rejects.
  const site = await loadSchema(config.schemaPath);
  const db = openDatabase(config.databasePath, { logger });

  const entries = createEntryRepository(db);
  const globals = createGlobalRepository(db);
  const users = createUserRepository(db);

  const existing = Object.values(entries.counts()).reduce((total, item) => total + item.total, 0);
  if (existing > 0 && !force) {
    process.stderr.write(
      `The database already holds ${existing} entries. Re-run with --force to seed anyway.\n`,
    );
    db.close();
    process.exit(1);
  }

  /** Writes an entry, validating it exactly as the API would. */
  const put = (
    collection: string,
    data: Record<string, unknown>,
    status: "draft" | "published",
  ) => {
    const def = site.collections[collection];
    if (!def) {
      // The model is loaded at runtime now, so this demo content and the schema
      // can disagree. Say which, rather than failing on a property of undefined.
      throw new Error(
        `The content model has no "${collection}" collection. ` +
          `This seed script is written for the example model in mica.config.ts; ` +
          `known collections: ${Object.keys(site.collections).join(", ") || "(none)"}.`,
      );
    }

    const result = validateFields(def.fields, data, "storage", {
      enforceRequired: status === "published",
    });

    if (!result.ok) {
      throw new Error(
        `Seed data for "${collection}" is invalid:\n` +
          result.issues.map((issue) => `  ${issue.path}: ${issue.message}`).join("\n"),
      );
    }

    const payload = result.data as Record<string, unknown>;
    const slugKey = resolveSlugField(def)!;
    const slug = (payload[slugKey] as string) || slugify(entryTitle(def, payload));
    payload[slugKey] = slug;

    const current = entries.findBySlug(collection, slug);
    if (current) {
      entries.update(current.id, { data: payload, status, userId: null });
    } else {
      entries.create({ collection, slug, status, data: payload, userId: null });
    }
  };

  db.transaction(() => {
    for (const page of pages) put("pages", { ...page }, "published");
    for (const member of team) put("team", { ...member }, "published");
    for (const project of projects) put("projects", { ...project }, "published");

    // One draft, so the draft/publish distinction is visible immediately.
    put("news", { ...news[0]! }, "published");
    put("news", { ...news[1]! }, "draft");

    globals.save(
      "site",
      {
        companyName: "Muster Consulting AG",
        tagline: "Practical advice for owner-led businesses",
        address: "Löwenstrasse 24\n8001 Zürich",
        email: "hallo@muster-consulting.example",
        phone: "+41 44 123 45 67",
        openingHours: "Monday to Friday, 08:00–17:00",
        position: { lat: 47.3739, lng: 8.5352 },
        social: [{ platform: "linkedin", url: "https://www.linkedin.com/company/example" }],
        seo: {
          titleSuffix: " — Muster Consulting AG",
          defaultDescription:
            "Independent consultancy in Zürich. Strategy, operations and digital projects for small and medium-sized businesses.",
          defaultImage: null,
        },
        analytics: { provider: "none", siteId: null, scriptUrl: null },
        logo: null,
      },
      null,
    );

    globals.save(
      "navigation",
      {
        main: [
          { label: "Projects", href: "/projects", children: [] },
          { label: "News", href: "/news", children: [] },
          { label: "Team", href: "/team", children: [] },
          { label: "About us", href: "/about-us", children: [] },
          { label: "Contact", href: "/contact", children: [] },
        ],
        footer: [
          { label: "Imprint", href: "/imprint" },
          { label: "Privacy", href: "/privacy" },
        ],
        footerNote: "© Muster Consulting AG",
      },
      null,
    );

    globals.save(
      "theme",
      { primaryColor: "#1f2937", accentColor: "#0ea5e9", fontFamily: "sans", borderRadius: "md" },
      null,
    );
  });

  if (users.count() === 0) {
    users.create({
      email: DEMO_EMAIL,
      name: "Demo Editor",
      role: "admin",
      passwordHash: await hashPassword(DEMO_PASSWORD),
    });
    logger.info("Created demo account", { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  }

  const counts = entries.counts();
  logger.info("Seeded demo content", counts);
  process.stdout.write(`\nSign in at ${config.CMS_BASE_URL}/admin/\n`);
  if (users.count() === 1) {
    process.stdout.write(`  ${DEMO_EMAIL} / ${DEMO_PASSWORD}\n\n`);
  }

  db.close();
}

main().catch((error: unknown) => {
  process.stderr.write(`\nSeeding failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
