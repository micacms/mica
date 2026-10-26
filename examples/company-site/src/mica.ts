/**
 * The content model for this project.
 *
 * A plain module: `defineSite` builds a data structure, and nothing here
 * imports Astro. That is what lets it be read from anywhere — the collections
 * in `content.config.ts` today, a script or a test tomorrow — and it is why the
 * model is not written inline there.
 *
 * Everything downstream follows from it: the TypeScript types the templates
 * render against, the validation Mica applies before a save reaches the
 * repository, the forms an editor sees, and the layout of the files on disk.
 * There is no code generation step and no schema to keep in step; renaming a
 * field here breaks the website build, which is the point.
 *
 * How it reaches Mica: `@micacms/astro` writes it to `content/.mica/schema.json`
 * on every build and dev-server start. Commit that file — Mica reads it out of
 * the repository it is already connected to.
 *
 * The DSL is not Zod with extra steps. `text({ label: "Title", maxLength: 120 })`
 * carries editorial meaning that `z.string().max(120)` cannot — a label, a
 * width, a group. Zod is generated from this, never the reverse.
 */

import {
  boolean,
  collection,
  color,
  coordinates,
  date,
  defineSite,
  email,
  media,
  number,
  object,
  referenceSet,
  relation,
  repeater,
  richText,
  select,
  singleton,
  slug,
  tags,
  text,
  textarea,
  url,
  type FieldMap,
} from "@micacms/core";

/**
 * Every text that a page shows is content, also a heading or the label of a
 * link: so an editor can change it, and the live preview can open it. A label
 * is required, because an empty one leaves a gap in the page.
 */
const label = (name: string, description?: string) =>
  text({
    label: name,
    required: true,
    ...(description ? { description } : {}),
  });

/** A link of a page: its text and its address. */
const link = (name: string) =>
  object({
    label: name,
    fields: {
      label: label("Text", "The text of the link."),
      href: label("Link", "An address on this website, like /contact/."),
    },
  });

/** A folded group of labels in the Labels singleton. */
const labelGroup = <F extends FieldMap>(
  name: string,
  description: string,
  fields: F,
) =>
  object({
    label: name,
    description,
    collapsible: true,
    collapsed: true,
    fields,
  });

export const site = defineSite({
  /**
   * Where the content lives, relative to the **Astro project root** — not to
   * this file, and not to whatever directory the build was started from. Said
   * once here, because the loaders, the published model and Mica's own view of
   * the repository all have to mean the same directory.
   */
  root: "./content",

  // The website's name at the top of the editor's menu.
  label: "Harbor Lane",

  collections: {
    pages: collection({
      label: "Pages",
      labelSingular: "Page",
      description: "Standalone pages such as About us, Services or Contact.",
      // The page of an entry: with MICA_SITE_URL the editor links to it, and the local editor shows Preview.
      url: "/{slug}/",
      defaultSort: { field: "position", direction: "asc" },
      sortable: true,
      fields: {
        title: text({
          label: "Title",
          required: true,
          maxLength: 120,
          listed: true,
        }),
        slug: slug({
          label: "URL",
          from: "title",
          description: "The address of the page, e.g. /about-us.",
        }),
        template: select({
          label: "Template",
          description:
            "A list page shows its collection below the content. Its URL must be the collection's: news for News, projects for Projects.",
          width: "half",
          default: "standard",
          options: [
            { label: "Standard page", value: "standard" },
            { label: "List of projects", value: "projects" },
            { label: "List of news", value: "news" },
            { label: "List of events", value: "events" },
            { label: "List of the team", value: "team" },
            { label: "Glossary", value: "glossary" },
          ],
        }),
        eyebrow: text({
          label: "Eyebrow",
          maxLength: 40,
          width: "half",
          description: "The short line above the title.",
        }),
        intro: textarea({
          label: "Introduction",
          rows: 3,
          maxLength: 400,
          description: "Short lead paragraph shown below the page title.",
        }),
        heroImage: media({
          label: "Hero image",
          accept: "image",
          alt: "required",
        }),
        body: richText({
          label: "Content",
          toolbar: "full",
        }),
        sections: repeater({
          label: "Extra sections",
          itemLabel: "heading",
          addLabel: "Add section",
          fields: {
            heading: text({ label: "Heading", required: true }),
            text: richText({ label: "Text" }),
            image: media({ label: "Image", accept: "image", alt: "required" }),
            layout: select({
              label: "Layout",
              options: [
                { label: "Image right", value: "image-right" },
                { label: "Image left", value: "image-left" },
                { label: "Full width", value: "full" },
              ],
              default: "image-right",
            }),
          },
        }),
        seo: object({
          label: "SEO",
          group: "Metadata",
          collapsible: true,
          collapsed: true,
          fields: {
            metaTitle: text({ label: "Meta title", maxLength: 60 }),
            metaDescription: textarea({
              label: "Meta description",
              rows: 2,
              maxLength: 160,
            }),
            ogImage: media({ label: "Social sharing image", accept: "image" }),
            noindex: boolean({ label: "Hide from search engines" }),
          },
        }),
      },
    }),

    projects: collection({
      label: "Projects",
      labelSingular: "Project",
      description: "Client projects shown in the portfolio.",
      // The category is a part of the address: Mica fills it in from the entry, for its links and the preview.
      url: "/projects/{category}/{slug}/",
      defaultSort: { field: "year", direction: "desc" },
      fields: {
        title: text({
          label: "Title",
          required: true,
          maxLength: 120,
          listed: true,
        }),
        slug: slug({ label: "URL", from: "title" }),
        year: number({
          label: "Year",
          integer: true,
          min: 1900,
          max: 2100,
          listed: true,
          width: "half",
        }),
        category: select({
          label: "Category",
          required: true,
          width: "half",
          listed: true,
          options: [
            { label: "Strategy", value: "strategy" },
            { label: "Operations", value: "operations" },
            { label: "Technology", value: "technology" },
            { label: "Public sector", value: "public-sector" },
          ],
        }),
        // Read-only: the editor shows the value, and nobody can change it there.
        // The pattern still applies when the file is checked.
        code: text({
          label: "Project number",
          readonly: true,
          width: "half",
          pattern: "[A-Z]{2}-[0-9]{3}",
          patternMessage:
            "Use two capital letters, a hyphen and three digits, like HL-104.",
        }),
        duration: number({
          label: "Duration",
          integer: true,
          min: 1,
          unit: "weeks",
          width: "half",
        }),
        // Tags are free words. Suggestions help the editor to stay consistent.
        tags: tags({
          label: "Tags",
          max: 6,
          maxLength: 24,
          suggestions: [
            "process",
            "finance",
            "data",
            "software",
            "people",
            "strategy",
          ],
        }),
        description: richText({
          label: "Description",
          toolbar: [
            "bold",
            "italic",
            "heading",
            "bulletList",
            "orderedList",
            "link",
            "image",
          ],
        }),
        location: object({
          label: "Location",
          fields: {
            address: text({ label: "Address" }),
            city: text({ label: "City", width: "half" }),
            country: text({ label: "Country", width: "half" }),
          },
        }),
        facts: repeater({
          label: "Key facts",
          itemLabel: "label",
          addLabel: "Add fact",
          max: 8,
          fields: {
            label: text({ label: "Label", required: true, width: "half" }),
            value: text({ label: "Value", required: true, width: "half" }),
          },
        }),
        gallery: media({
          label: "Images",
          accept: "image",
          alt: "required",
          multiple: true,
          description: "The first image is used as the preview.",
        }),
        team: relation({
          label: "Team involved",
          collection: "team",
          multiple: true,
        }),
        // A relation to reference data: the sectors come from a file of the website, and Mica never edits them.
        sector: relation({
          label: "Sector",
          collection: "sectors",
          description: "The client's economic sector, from the NACE list.",
        }),
        // Files beside images: the field takes only these types, each checked from its bytes.
        downloads: media({
          label: "Downloads",
          accept: ["pdf", "zip", "csv"],
          multiple: true,
          max: 4,
          description:
            "Files that visitors can download, such as a case study.",
        }),
        featured: boolean({
          label: "Show on the homepage",
        }),
      },
    }),

    news: collection({
      label: "News",
      labelSingular: "Article",
      url: "/news/{slug}/",
      defaultSort: { field: "publishDate", direction: "desc" },
      fields: {
        title: text({
          label: "Title",
          required: true,
          maxLength: 140,
          listed: true,
        }),
        slug: slug({ label: "URL", from: "title" }),
        publishDate: date({ label: "Date", listed: true, width: "half" }),
        author: relation({
          label: "Author",
          collection: "team",
          width: "half",
        }),
        relatedProject: relation({
          label: "Related project",
          collection: "projects",
          description: "The article links to this project's page.",
        }),
        tags: tags({
          label: "Tags",
          max: 5,
          maxLength: 24,
          suggestions: ["research", "careers", "case study", "operations"],
        }),
        excerpt: textarea({ label: "Teaser", rows: 3, maxLength: 300 }),
        coverImage: media({
          label: "Cover image",
          accept: "image",
          alt: "required",
        }),
        body: richText({ label: "Article" }),
      },
    }),

    events: collection({
      label: "Events",
      labelSingular: "Event",
      description: "Workshops and talks, in person or online.",
      url: "/events/{slug}/",
      defaultSort: { field: "startsAt", direction: "desc" },
      fields: {
        title: text({
          label: "Title",
          required: true,
          maxLength: 120,
          listed: true,
        }),
        slug: slug({ label: "URL", from: "title" }),
        startsAt: date({
          label: "Starts",
          includeTime: true,
          required: true,
          listed: true,
          width: "half",
        }),
        endsAt: date({ label: "Ends", includeTime: true, width: "half" }),
        format: select({
          label: "Format",
          multiple: true,
          width: "half",
          options: [
            { label: "In person", value: "in-person" },
            { label: "Online", value: "online" },
          ],
        }),
        capacity: number({
          label: "Capacity",
          integer: true,
          min: 1,
          unit: "seats",
          width: "half",
        }),
        venue: object({
          label: "Venue",
          group: "Where",
          fields: {
            name: text({ label: "Name" }),
            address: textarea({ label: "Address", rows: 2 }),
            // A map to pick the place. It also stores the zoom, which the event page uses.
            place: coordinates({ label: "Place on the map", map: "positron" }),
          },
        }),
        registrationUrl: url({
          label: "Registration link",
          group: "Where",
          placeholder: "https://harborlane.example/register/...",
        }),
        speakers: relation({
          label: "Speakers",
          collection: "team",
          multiple: true,
        }),
        summary: textarea({ label: "Summary", rows: 3, maxLength: 300 }),
        body: richText({ label: "Programme" }),
        tags: tags({
          label: "Tags",
          max: 5,
          maxLength: 24,
          suggestions: ["workshop", "webinar", "operations", "technology"],
          default: ["event"],
        }),
      },
    }),

    team: collection({
      label: "Team",
      labelSingular: "Team member",
      url: "/team/{slug}/",
      defaultSort: { field: "position", direction: "asc" },
      sortable: true,
      fields: {
        name: text({ label: "Name", required: true, listed: true }),
        slug: slug({ label: "URL", from: "name" }),
        role: text({ label: "Role", listed: true, width: "half" }),
        email: email({ label: "Email", width: "half" }),
        phone: text({
          label: "Phone",
          width: "half",
          placeholder: "+990 40 555 0143",
          pattern: "\\+[0-9 ]{7,18}",
          patternMessage: "Use the international form, like +990 40 555 0143.",
        }),
        portrait: media({
          label: "Portrait",
          accept: "image",
          alt: "required",
        }),
        bio: textarea({ label: "Short biography", rows: 4, maxLength: 600 }),
        featured: boolean({ label: "Show on the team page", default: false }),
      },
    }),
  },

  singletons: {
    general: singleton({
      label: "General",
      description: "Company details, contact information and default SEO.",
      fields: {
        companyName: text({ label: "Company name", required: true }),
        logo: media({ label: "Logo", accept: "image" }),
        tagline: text({ label: "Tagline", maxLength: 160 }),
        address: textarea({ label: "Address", rows: 3, group: "Contact" }),
        email: email({ label: "Email", group: "Contact", width: "half" }),
        phone: text({ label: "Phone", group: "Contact", width: "half" }),
        openingHours: textarea({
          label: "Opening hours",
          rows: 3,
          group: "Contact",
        }),
        social: repeater({
          label: "Social links",
          group: "Contact",
          itemLabel: "platform",
          addLabel: "Add link",
          fields: {
            platform: select({
              label: "Platform",
              width: "half",
              options: [
                { label: "LinkedIn", value: "linkedin" },
                { label: "Instagram", value: "instagram" },
                { label: "Facebook", value: "facebook" },
                { label: "YouTube", value: "youtube" },
                { label: "X", value: "x" },
              ],
            }),
            url: url({ label: "URL", required: true, width: "half" }),
          },
        }),
        seo: object({
          label: "Default SEO",
          group: "Metadata",
          collapsible: true,
          fields: {
            titleSuffix: text({
              label: "Title suffix",
              description:
                'Appended to every page title, e.g. " — Harbor Lane Consulting".',
            }),
            defaultDescription: textarea({
              label: "Default description",
              rows: 2,
              maxLength: 160,
            }),
            defaultImage: media({
              label: "Default sharing image",
              accept: "image",
            }),
          },
        }),
        analytics: object({
          label: "Analytics",
          group: "Metadata",
          collapsible: true,
          collapsed: true,
          fields: {
            provider: select({
              label: "Provider",
              options: [
                { label: "None", value: "none" },
                { label: "Plausible", value: "plausible" },
                { label: "Matomo", value: "matomo" },
              ],
              default: "none",
            }),
            siteId: text({
              label: "Site ID",
              description:
                "The script address is in the website's code, not here.",
            }),
          },
        }),
      },
    }),

    homePage: singleton({
      label: "Home page",
      description:
        "The texts of the home page. Its title and introduction are the tagline and the description in General.",
      url: "/",
      fields: {
        primaryLink: link("First button"),
        secondaryLink: link("Second button"),
        projects: object({
          label: "Projects section",
          fields: { eyebrow: label("Eyebrow"), title: label("Title") },
        }),
        events: object({
          label: "Events section",
          fields: { eyebrow: label("Eyebrow"), title: label("Title") },
        }),
        news: object({
          label: "News section",
          fields: { eyebrow: label("Eyebrow"), title: label("Title") },
        }),
        contact: object({
          label: "Contact box",
          fields: {
            title: label("Title"),
            text: textarea({ label: "Text", rows: 2 }),
            link: link("Button"),
          },
        }),
      },
    }),

    labels: singleton({
      label: "Labels",
      description:
        "The short texts of the templates, such as headings and the text of links. The pages themselves are in Pages.",
      fields: {
        general: labelGroup(
          "On every page",
          "In the header, and for screen readers.",
          {
            skipLink: label(
              "Skip link",
              "The first link of each page, for keyboard users.",
            ),
            menu: label(
              "Menu button",
              "On small screens. Only screen readers read it.",
            ),
            mainMenu: label(
              "Name of the main menu",
              "Only screen readers read it.",
            ),
            tags: label(
              "Name of a list of tags",
              "Only screen readers read it.",
            ),
          },
        ),
        footer: labelGroup(
          "Footer",
          "Below each page. The links are in Navigation.",
          {
            link: link("Link below the company name"),
            contact: label("Contact heading"),
            openingHours: label("Opening hours heading"),
            more: label("Heading of the links"),
            sitemap: label("Sitemap link"),
          },
        ),
        projects: labelGroup(
          "Projects",
          "On the list of projects and on each project's page.",
          {
            allLink: label(
              "Link to the list",
              "On the home page and on each project, like “All projects”.",
            ),
            empty: label("Text without projects"),
            noImage: label(
              "Text without an image",
              "On a project's card that has no image.",
            ),
            keyFacts: label("Key facts"),
            project: label("Project details"),
            number: label("Number"),
            duration: label("Duration"),
            weeks: label(
              "Unit of the duration",
              "After the number, like “weeks”.",
            ),
            sector: label("Sector"),
            downloads: label("Downloads"),
            location: label("Location"),
            team: label("Team"),
            gallery: label("Gallery", "Only screen readers read it."),
          },
        ),
        news: labelGroup("News", "On the list of news and on each article.", {
          allLink: label(
            "Link to the list",
            "On the home page and on each article, like “All news”.",
          ),
          empty: label("Text without articles"),
          readMore: label("Read more"),
          by: label("By", "Before the author's name, like “by”."),
          relatedProject: label("Related project"),
        }),
        events: labelGroup(
          "Events",
          "On the list of events and on each event's page.",
          {
            allLink: label(
              "Link to the list",
              "On the home page and on each event, like “All events”.",
            ),
            upcoming: label("Upcoming events"),
            noUpcoming: label("Text without upcoming events"),
            past: label("Past events"),
            when: label("When"),
            until: label("Until", "Between the start and the end."),
            format: label("Format"),
            and: label(
              "And",
              "Between two formats, like “In person and Online”.",
            ),
            seats: label(
              "Unit of the capacity",
              "After the number, like “seats”.",
            ),
            venue: label("Venue"),
            map: label(
              "Name of the map",
              "Before the venue's name. Only screen readers read it.",
            ),
            speakers: label("Speakers"),
            register: label("Register"),
            isPast: label("Text after the event"),
          },
        ),
        team: labelGroup(
          "Team",
          "On the list of the team and on each person's page.",
          {
            allLink: label(
              "Link to the list",
              "On each person's page, like “Team”.",
            ),
            empty: label("Text without team members"),
            projects: label("Projects"),
            events: label("Events"),
          },
        ),
        notFound: labelGroup(
          "Page not found",
          "For an address that does not exist.",
          {
            pageTitle: label(
              "Title of the browser tab",
              "Search engines also show it.",
            ),
            eyebrow: label("Eyebrow"),
            title: label("Title"),
            text: textarea({ label: "Text", rows: 2 }),
            link: link("Button"),
          },
        ),
      },
    }),

    navigation: singleton({
      label: "Navigation",
      description: "Main menu and footer links.",
      fields: {
        main: repeater({
          label: "Main menu",
          itemLabel: "label",
          addLabel: "Add menu item",
          fields: {
            label: text({ label: "Label", required: true, width: "half" }),
            href: text({
              label: "Link",
              required: true,
              width: "half",
              placeholder: "/projects",
            }),
            children: repeater({
              label: "Submenu",
              itemLabel: "label",
              addLabel: "Add submenu item",
              fields: {
                label: text({ label: "Label", required: true, width: "half" }),
                href: text({ label: "Link", required: true, width: "half" }),
              },
            }),
          },
        }),
        footer: repeater({
          label: "Footer links",
          itemLabel: "label",
          addLabel: "Add footer link",
          fields: {
            label: text({ label: "Label", required: true, width: "half" }),
            href: text({ label: "Link", required: true, width: "half" }),
          },
        }),
        footerNote: textarea({ label: "Footer note", rows: 2 }),
      },
    }),

    theme: singleton({
      label: "Theme",
      description: "Colours and typography for the public website.",
      fields: {
        primaryColor: color({
          label: "Primary colour",
          default: "#1f2937",
          width: "half",
          presets: ["#1f2937", "#0f766e", "#1d4ed8", "#b91c1c", "#a16207"],
        }),
        accentColor: color({
          label: "Accent colour",
          default: "#0ea5e9",
          width: "half",
          presets: ["#0ea5e9", "#f97316", "#22c55e", "#e11d48", "#8b5cf6"],
        }),
        fontFamily: select({
          label: "Typeface",
          width: "half",
          default: "sans",
          options: [
            { label: "Sans serif", value: "sans" },
            { label: "Serif", value: "serif" },
            { label: "Grotesque", value: "grotesque" },
          ],
        }),
        borderRadius: select({
          label: "Corner rounding",
          width: "half",
          default: "md",
          options: [
            { label: "Square", value: "none" },
            { label: "Subtle", value: "sm" },
            { label: "Rounded", value: "md" },
            { label: "Very rounded", value: "lg" },
          ],
        }),
      },
    }),
  },

  /**
   * Data of the website that Mica does not edit: the NACE sections, which the
   * EU publishes. `content.config.ts` reads the file as the Astro collection
   * `sectors`, and the build writes `content/.mica/references/sectors.json`
   * for the editor's picker.
   */
  references: {
    sectors: referenceSet({
      label: "Sectors",
      file: "src/reference/sectors.json",
      title: "name",
    }),
  },
});
