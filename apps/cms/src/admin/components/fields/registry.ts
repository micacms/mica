/**
 * Field registry (§11).
 *
 * The one place that maps a schema `kind` to a control. Adding a field type
 * means adding a builder in `packages/model` and one line here — no plugin
 * architecture, which V1 explicitly does not want.
 *
 * `object` and `repeater` are async because they render `FieldRenderer`, which
 * renders them: a static import would be a module cycle.
 */

import { defineAsyncComponent, type Component } from "vue";

import type { FieldKind } from "@micacms/model";

import BooleanField from "./BooleanField.vue";
import ColorField from "./ColorField.vue";
import CoordinatesField from "./CoordinatesField.vue";
import DateField from "./DateField.vue";
import MediaField from "./MediaField.vue";
import NumberField from "./NumberField.vue";
import RelationField from "./RelationField.vue";
import RichTextField from "./RichTextField.vue";
import SelectField from "./SelectField.vue";
import SlugField from "./SlugField.vue";
import TextField from "./TextField.vue";
import TextareaField from "./TextareaField.vue";

export const fieldComponents: Record<FieldKind, Component> = {
  text: TextField,
  textarea: TextareaField,
  richText: RichTextField,
  number: NumberField,
  boolean: BooleanField,
  date: DateField,
  // Same control as text, distinguished by input type.
  email: TextField,
  url: TextField,
  slug: SlugField,
  select: SelectField,
  object: defineAsyncComponent(() => import("./ObjectField.vue")),
  repeater: defineAsyncComponent(() => import("./RepeaterField.vue")),
  relation: RelationField,
  media: MediaField,
  color: ColorField,
  coordinates: CoordinatesField,
};
