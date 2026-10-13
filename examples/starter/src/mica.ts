/**
 * The content model. Mica builds the editor's forms from it, checks every save
 * against it, and gives the pages their types. Change it here, and the build
 * writes `content/.mica/schema.json` for Mica to read: commit that file too.
 */

import { collection, date, defineSite, media, richText, singleton, slug, tags, text, textarea } from "@micacms/core";

export const site = defineSite({
  root: "./content",
  collections: {
    posts: collection({
      label: "Posts",
      labelSingular: "Post",
      defaultSort: { field: "publishDate", direction: "desc" },
      fields: {
        title: text({ label: "Title", required: true, maxLength: 120, listed: true }),
        slug: slug({ label: "URL", from: "title" }),
        publishDate: date({ label: "Date", required: true, listed: true, width: "half" }),
        tags: tags({ label: "Tags", width: "half" }),
        cover: media({ label: "Cover image", accept: "image", alt: "required" }),
        excerpt: textarea({ label: "Teaser", rows: 3, maxLength: 300 }),
        body: richText({ label: "Text" }),
      },
    }),
  },
  singletons: {
    site: singleton({
      label: "Website",
      fields: {
        title: text({ label: "Site name", required: true }),
        description: textarea({ label: "Description", rows: 2, maxLength: 160 }),
      },
    }),
  },
});
