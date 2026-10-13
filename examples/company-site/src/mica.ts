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
} from "@micacms/core";

export const site = defineSite({
  /**
   * Where the content lives, relative to the **Astro project root** — not to
   * this file, and not to whatever directory the build was started from. Said
   * once here, because the loaders, the published model and Mica's own view of
   * the repository all have to mean the same directory.
   */
  root: "./content",

  collections: {
    pages: collection({
      label: "Pages",
      labelSingular: "Page",
      description: "Standalone pages such as About us, Services or Contact.",
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
          toolbar: [
            "bold",
            "italic",
            "heading",
            "bulletList",
            "orderedList",
            "blockquote",
            "link",
            "horizontalRule",
          ],
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
          suggestions: ["process", "finance", "data", "software", "people", "strategy"],
        }),
        description: richText({ label: "Description" }),
        location: object({
          label: "Location",
          fields: {
            address: text({ label: "Address" }),
            city: text({ label: "City", width: "half" }),
            country: text({ label: "Country", width: "half" }),
            position: coordinates({
              label: "Map position",
            }),
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
        featured: boolean({
          label: "Show on the homepage",
        }),
      },
    }),

    news: collection({
      label: "News",
      labelSingular: "Article",
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
        coverImage: media({ label: "Cover image", accept: "image", alt: "required" }),
        body: richText({ label: "Article" }),
      },
    }),

    events: collection({
      label: "Events",
      labelSingular: "Event",
      description: "Workshops and talks, in person or online.",
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
            position: coordinates({ label: "Map position" }),
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
          placeholder: "+351 21 555 0143",
          pattern: "\\+[0-9 ]{7,18}",
          patternMessage: "Use the international form, like +351 21 555 0143.",
        }),
        portrait: media({ label: "Portrait", accept: "image", alt: "required" }),
        bio: textarea({ label: "Short biography", rows: 4, maxLength: 600 }),
        featured: boolean({ label: "Show on the team page", default: false }),
      },
    }),
  },

  singletons: {
    site: singleton({
      label: "Website",
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
        position: coordinates({
          label: "Map position",
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
              description: 'Appended to every page title, e.g. " — Harbor Lane Consulting".',
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
            siteId: text({ label: "Site ID" }),
            scriptUrl: url({ label: "Script URL" }),
          },
        }),
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
});

export type SiteModel = typeof site;
