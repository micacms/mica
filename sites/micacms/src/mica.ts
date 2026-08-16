import {
  boolean,
  collection,
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
} from "@micacms/model";

const linkFields = {
  label: text({ label: "Label", required: true, width: "half" }),
  href: text({ label: "Link", required: true, width: "half" }),
};

export const site = defineSite({
  root: "./content",
  collections: {
    features: collection({
      label: "Features",
      labelSingular: "Feature",
      description: "Product capabilities used on the home and feature pages.",
      sortable: true,
      defaultSort: { field: "position", direction: "asc" },
      fields: {
        title: text({ label: "Title", required: true, listed: true, maxLength: 80 }),
        slug: slug({ label: "URL", from: "title" }),
        icon: select({
          label: "Icon",
          required: true,
          listed: true,
          options: [
            { label: "Repository", value: "repository" },
            { label: "Model", value: "model" },
            { label: "Edit", value: "edit" },
            { label: "History", value: "history" },
            { label: "Image", value: "image" },
            { label: "Shield", value: "shield" },
          ],
        }),
        eyebrow: text({ label: "Eyebrow", maxLength: 40 }),
        summary: textarea({ label: "Summary", required: true, rows: 3, maxLength: 220 }),
        detail: richText({ label: "Detail" }),
        outcomes: repeater({
          label: "Outcomes",
          itemLabel: "text",
          addLabel: "Add outcome",
          max: 5,
          fields: { text: text({ label: "Outcome", required: true }) },
        }),
      },
    }),
    docs: collection({
      label: "Documentation",
      labelSingular: "Document",
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
            { label: "Operate", value: "operate" },
          ],
        }),
        summary: textarea({ label: "Summary", required: true, rows: 2, maxLength: 200 }),
        readTime: number({ label: "Read time", unit: "min", integer: true, min: 1, max: 60 }),
        body: richText({
          label: "Guide",
          toolbar: ["bold", "italic", "heading", "bulletList", "orderedList", "blockquote", "link", "horizontalRule"],
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
      description: "All editorial content for the main marketing page.",
      fields: {
        heroEyebrow: text({ label: "Hero eyebrow", required: true }),
        heroTitle: textarea({ label: "Hero title", required: true, rows: 2, maxLength: 120 }),
        heroSummary: textarea({ label: "Hero summary", required: true, rows: 3, maxLength: 320 }),
        primaryCta: object({ label: "Primary action", required: true, fields: linkFields }),
        secondaryCta: object({ label: "Secondary action", required: true, fields: linkFields }),
        stats: repeater({
          label: "Product facts",
          itemLabel: "value",
          max: 4,
          fields: {
            value: text({ label: "Value", required: true, width: "third" }),
            label: text({ label: "Label", required: true, width: "third" }),
            note: text({ label: "Note", width: "third" }),
          },
        }),
        problemEyebrow: text({ label: "Positioning eyebrow", required: true }),
        problemTitle: textarea({ label: "Positioning title", required: true, rows: 2 }),
        problemSummary: textarea({ label: "Positioning summary", required: true, rows: 3 }),
        workflowTitle: text({ label: "Workflow title", required: true }),
        workflowSummary: textarea({ label: "Workflow summary", required: true, rows: 2 }),
        workflowSteps: repeater({
          label: "Workflow steps",
          itemLabel: "title",
          min: 3,
          max: 3,
          fields: {
            title: text({ label: "Title", required: true }),
            text: textarea({ label: "Text", required: true, rows: 2 }),
            detail: text({ label: "Technical detail" }),
          },
        }),
        featuresEyebrow: text({ label: "Features eyebrow", required: true }),
        featuresTitle: text({ label: "Features title", required: true }),
        featuresSummary: textarea({ label: "Features summary", required: true, rows: 2 }),
        principles: repeater({
          label: "Product principles",
          itemLabel: "title",
          fields: {
            number: text({ label: "Number", required: true, width: "third" }),
            title: text({ label: "Title", required: true, width: "third" }),
            text: textarea({ label: "Text", required: true, rows: 3, width: "third" }),
          },
        }),
        ctaTitle: text({ label: "CTA title", required: true }),
        ctaText: textarea({ label: "CTA text", required: true, rows: 2 }),
      },
    }),
    product: singleton({
      label: "Product page",
      description: "Editorial content for the detailed product page.",
      fields: {
        eyebrow: text({ label: "Eyebrow", required: true }),
        title: textarea({ label: "Title", required: true, rows: 2 }),
        summary: textarea({ label: "Summary", required: true, rows: 3 }),
        audiences: repeater({
          label: "Audiences",
          itemLabel: "title",
          fields: {
            title: text({ label: "Title", required: true }),
            text: textarea({ label: "Text", required: true, rows: 3 }),
          },
        }),
        stack: repeater({
          label: "Technical stack",
          itemLabel: "name",
          fields: {
            name: text({ label: "Name", required: true, width: "half" }),
            role: text({ label: "Role", required: true, width: "half" }),
          },
        }),
      },
    }),
    imprint: singleton({
      label: "Imprint",
      description: "The legal notice: who is responsible for the website, and how to reach them.",
      fields: {
        eyebrow: text({ label: "Eyebrow", required: true }),
        title: text({ label: "Title", required: true }),
        lead: textarea({ label: "Lead", required: true, rows: 2 }),
        entityName: text({ label: "Name", required: true, help: "The person or company answering for this website." }),
        street: text({ label: "Street and number", required: true }),
        postalCode: text({ label: "Postal code", required: true, width: "third" }),
        city: text({ label: "City", required: true, width: "third" }),
        country: text({ label: "Country", required: true, width: "third" }),
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
