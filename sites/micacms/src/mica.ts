import {
  boolean,
  collection,
  coordinates,
  date,
  defineSite,
  email,
  number,
  object,
  repeater,
  richText,
  select,
  singleton,
  slug,
  text,
  textarea,
  url,
} from "@micacms/core";

const linkFields = {
  label: text({ label: "Label", required: true, width: "half" }),
  href: text({ label: "Link", required: true, width: "half" }),
};

export const site = defineSite({
  root: "./content",
  collections: {
    docs: collection({
      label: "Documentation",
      labelSingular: "Document",
      url: "/docs/{slug}/",
      description: "Public guides for setup, modelling, and deployment.",
      defaultSort: { field: "position", direction: "asc" },
      sortable: true,
      fields: {
        title: text({ label: "Title", required: true, listed: true }),
        slug: slug({ label: "URL", from: "title" }),
        section: select({
          label: "Section",
          required: true,
          listed: true,
          options: [
            { label: "Start", value: "start" },
            { label: "Build", value: "build" },
            { label: "Edit", value: "edit" },
            { label: "Operate", value: "operate" },
            { label: "Reference", value: "reference" },
          ],
        }),
        summary: textarea({ label: "Summary", required: true, rows: 2, maxLength: 200 }),
        readTime: number({ label: "Read time", unit: "min", integer: true, min: 1, max: 60 }),
        body: richText({
          label: "Guide",
          toolbar: "full",
        }),
      },
    }),
    releases: collection({
      label: "Releases",
      labelSingular: "Release",
      description: "Product changes shown on the public changelog.",
      defaultSort: { field: "publishDate", direction: "desc" },
      fields: {
        title: text({ label: "Title", required: true, listed: true }),
        slug: slug({ label: "URL", from: "title" }),
        version: text({ label: "Version", required: true, listed: true, width: "half" }),
        publishDate: date({ label: "Date", required: true, listed: true, width: "half" }),
        summary: textarea({ label: "Summary", required: true, rows: 2, maxLength: 240 }),
        body: richText({ label: "Release notes" }),
        latest: boolean({ label: "Latest release", default: false }),
      },
    }),
  },
  singletons: {
    site: singleton({
      label: "Website",
      description: "Product identity, links, and default metadata.",
      fields: {
        productName: text({ label: "Product name", required: true }),
        tagline: text({ label: "Tagline", required: true, maxLength: 160 }),
        description: textarea({ label: "Default description", required: true, rows: 2, maxLength: 160 }),
        currentVersion: text({ label: "Current version", required: true, width: "third" }),
        githubUrl: url({ label: "GitHub URL", required: true, width: "third" }),
        npmUrl: url({ label: "npm URL", required: true, width: "third" }),
        announcement: object({
          label: "Announcement",
          required: true,
          fields: {
            text: text({ label: "Text", required: true, width: "half" }),
            href: text({ label: "Link", required: true, width: "half" }),
          },
        }),
        status: object({
          label: "Project status",
          description: "Shown in the banner above every page and next to the version in the footer.",
          required: true,
          fields: {
            label: text({ label: "Footer label", required: true, width: "half", description: "After the version, such as pre-1.0." }),
            bannerTitle: text({ label: "Banner title", required: true, width: "half" }),
            bannerText: text({ label: "Banner text", required: true }),
            bannerLink: text({ label: "Banner link text", required: true }),
          },
        }),
      },
    }),
    pages: singleton({
      label: "Page headers",
      description: "The headings and the lead texts of the docs index, the changelog and the 404 page.",
      fields: {
        docs: object({
          label: "Documentation index",
          required: true,
          fields: {
            eyebrow: text({ label: "Eyebrow", required: true }),
            title: text({ label: "Title", required: true }),
            lead: textarea({ label: "Lead", required: true, rows: 2 }),
            filterLabel: text({ label: "Filter field label", required: true }),
            noResults: text({ label: "No result text", required: true }),
          },
        }),
        changelog: object({
          label: "Changelog",
          required: true,
          fields: {
            eyebrow: text({ label: "Eyebrow", required: true }),
            title: text({ label: "Title", required: true }),
            lead: textarea({ label: "Lead", required: true, rows: 2 }),
            currentLabel: text({ label: "Label of the current release", required: true }),
            sourceNote: text({ label: "Note about the source changelog", required: true }),
            sourceLink: text({ label: "Link text to the source changelog", required: true }),
          },
        }),
        notFound: object({
          label: "Page not found",
          required: true,
          fields: {
            title: text({ label: "Title", required: true }),
            text: text({ label: "Text", required: true }),
            action: text({ label: "Button", required: true }),
          },
        }),
      },
    }),
    navigation: singleton({
      label: "Navigation",
      description: "Header and footer navigation.",
      fields: {
        main: repeater({ label: "Main navigation", itemLabel: "label", fields: linkFields }),
        footerGroups: repeater({
          label: "Footer groups",
          itemLabel: "title",
          fields: {
            title: text({ label: "Title", required: true }),
            links: repeater({ label: "Links", itemLabel: "label", fields: linkFields }),
          },
        }),
        footerNote: text({ label: "Footer note", required: true }),
      },
    }),
    home: singleton({
      label: "Home page",
      url: "/",
      description: "All copy on the home page, from top to bottom.",
      fields: {
        hero: object({
          label: "Hero",
          required: true,
          fields: {
            eyebrow: text({ label: "Eyebrow", required: true, maxLength: 60 }),
            title: textarea({ label: "Headline", required: true, rows: 2, maxLength: 120 }),
            lead: richText({ label: "Lead", required: true, toolbar: ["bold", "italic", "link"] }),
            primary: object({ label: "Main action", required: true, fields: linkFields }),
            secondary: object({ label: "Second action", required: true, fields: linkFields }),
          },
        }),
        how: object({
          label: "How it works",
          required: true,
          fields: {
            eyebrow: text({ label: "Eyebrow", required: true }),
            title: text({ label: "Title", required: true }),
            lead: textarea({ label: "Lead", required: true, rows: 2 }),
            steps: repeater({
              label: "Steps",
              itemLabel: "title",
              min: 3,
              max: 3,
              fields: {
                title: text({ label: "Title", required: true }),
                text: textarea({ label: "Text", required: true, rows: 3 }),
                visual: select({
                  label: "Picture",
                  required: true,
                  options: [
                    { label: "Code", value: "code" },
                    { label: "Editor form", value: "editor" },
                    { label: "Change and commit", value: "change" },
                  ],
                }),
                file: text({ label: "File path", description: "Shown above the code." }),
                code: textarea({ label: "Code", rows: 10, description: "For a change, start lines with + or -." }),
              },
            }),
          },
        }),
        capabilities: object({
          label: "What it handles",
          required: true,
          fields: {
            eyebrow: text({ label: "Eyebrow", required: true }),
            title: text({ label: "Title", required: true }),
            lead: textarea({ label: "Lead", required: true, rows: 2 }),
            items: repeater({
              label: "Capabilities",
              itemLabel: "title",
              min: 3,
              max: 6,
              fields: {
                title: text({ label: "Title", required: true }),
                icon: select({
                  label: "Icon",
                  required: true,
                  options: [
                    { label: "Images", value: "images" },
                    { label: "Map", value: "map" },
                    { label: "Files", value: "files" },
                    { label: "Reference data", value: "database" },
                    { label: "Preview", value: "eye" },
                    { label: "Git branch", value: "git" },
                  ],
                }),
                text: textarea({ label: "Text", required: true, rows: 3 }),
                file: text({ label: "File path", description: "Shown above the code." }),
                code: textarea({ label: "Code", rows: 3 }),
                link: object({ label: "Link", required: true, fields: linkFields }),
              },
            }),
          },
        }),
        audiences: object({
          label: "Editors and developers",
          required: true,
          fields: {
            eyebrow: text({ label: "Eyebrow", required: true }),
            title: text({ label: "Title", required: true }),
            groups: repeater({
              label: "Groups",
              itemLabel: "title",
              min: 2,
              max: 2,
              fields: {
                title: text({ label: "Title", required: true }),
                text: textarea({ label: "Text", required: true, rows: 3 }),
                points: repeater({
                  label: "Points",
                  itemLabel: "text",
                  max: 5,
                  fields: { text: text({ label: "Point", required: true }) },
                }),
              },
            }),
          },
        }),
        agents: object({
          label: "Agents",
          required: true,
          fields: {
            eyebrow: text({ label: "Eyebrow", required: true }),
            title: text({ label: "Title", required: true }),
            lead: textarea({ label: "Lead", required: true, rows: 3 }),
            points: repeater({
              label: "Points",
              itemLabel: "text",
              max: 5,
              fields: { text: text({ label: "Point", required: true }) },
            }),
            file: text({ label: "File path", description: "Shown above the code." }),
            code: textarea({ label: "Code", rows: 6 }),
            link: object({ label: "Link", required: true, fields: linkFields }),
          },
        }),
        scale: object({
          label: "Scale and tests",
          required: true,
          fields: {
            eyebrow: text({ label: "Eyebrow", required: true }),
            title: text({ label: "Title", required: true }),
            lead: textarea({ label: "Lead", required: true, rows: 2 }),
            facts: repeater({
              label: "Facts",
              itemLabel: "label",
              min: 2,
              max: 4,
              fields: {
                value: text({ label: "Value", required: true, width: "half" }),
                label: text({ label: "What it counts", required: true, width: "half" }),
              },
            }),
            link: object({ label: "Link", required: true, fields: linkFields }),
          },
        }),
        run: object({
          label: "Ways to run",
          required: true,
          fields: {
            eyebrow: text({ label: "Eyebrow", required: true }),
            title: text({ label: "Title", required: true }),
            lead: textarea({ label: "Lead", required: true, rows: 2 }),
            needsTitle: text({ label: "Title above the needs", required: true }),
            options: repeater({
              label: "Options",
              itemLabel: "title",
              min: 2,
              max: 2,
              fields: {
                title: text({ label: "Title", required: true, width: "half" }),
                audience: text({ label: "For whom", required: true, width: "half" }),
                text: textarea({ label: "Text", required: true, rows: 3 }),
                command: text({ label: "Command or image", required: true }),
                needs: repeater({
                  label: "What you need",
                  itemLabel: "text",
                  max: 5,
                  fields: { text: text({ label: "Need", required: true }) },
                }),
                link: object({ label: "Link", required: true, fields: linkFields }),
              },
            }),
          },
        }),
        fit: object({
          label: "Is Mica for you",
          required: true,
          fields: {
            eyebrow: text({ label: "Eyebrow", required: true }),
            title: text({ label: "Title", required: true }),
            lead: textarea({ label: "Lead", required: true, rows: 2 }),
            goodTitle: text({ label: "Good fit, title", required: true, width: "half" }),
            notTitle: text({ label: "Not a fit, title", required: true, width: "half" }),
            good: repeater({
              label: "A good fit",
              itemLabel: "text",
              max: 6,
              fields: { text: text({ label: "Point", required: true }) },
            }),
            not: repeater({
              label: "Not a good fit",
              itemLabel: "text",
              max: 6,
              fields: { text: text({ label: "Point", required: true }) },
            }),
            link: object({ label: "Link", required: true, fields: linkFields }),
          },
        }),
        start: object({
          label: "Start",
          required: true,
          fields: {
            title: text({ label: "Title", required: true }),
            text: textarea({ label: "Text", required: true, rows: 3 }),
            paths: repeater({
              label: "Ways to start",
              itemLabel: "label",
              min: 1,
              max: 6,
              fields: {
                label: text({ label: "Tab", required: true, maxLength: 60 }),
                kind: select({
                  label: "Kind",
                  required: true,
                  options: [
                    { label: "Prompt for a coding agent", value: "prompt" },
                    { label: "Commands", value: "commands" },
                    { label: "Coming soon", value: "soon" },
                  ],
                }),
                content: textarea({ label: "Prompt, commands or text", required: true, rows: 6, description: "In commands, lines that start with # are comments." }),
              },
            }),
            link: object({ label: "Link", required: true, fields: linkFields }),
          },
        }),
      },
    }),
    imprint: singleton({
      label: "Imprint",
      url: "/imprint/",
      description: "The legal notice: who is responsible for the website, and how to reach them.",
      fields: {
        eyebrow: text({ label: "Eyebrow", required: true }),
        title: text({ label: "Title", required: true }),
        lead: textarea({ label: "Lead", required: true, rows: 2 }),
        entityName: text({ label: "Name", required: true, description: "The person or company answering for this website." }),
        street: text({ label: "Street and number", required: true }),
        postalCode: text({ label: "Postal code", required: true, width: "third" }),
        city: text({ label: "City", required: true, width: "third" }),
        country: text({ label: "Country", required: true, width: "third" }),
        location: coordinates({ label: "Location", description: "Where the address is. The page links to it on a map.", map: "liberty" }),
        email: email({ label: "Email", required: true }),
        sections: repeater({
          label: "Further sections",
          itemLabel: "title",
          addLabel: "Add section",
          fields: {
            title: text({ label: "Title", required: true }),
            body: richText({
              label: "Text",
              toolbar: ["bold", "italic", "bulletList", "link"],
            }),
          },
        }),
      },
    }),
  },
});

export type SiteModel = typeof site;
