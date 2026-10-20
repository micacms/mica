# 36. The editor saves by itself

**Status:** Accepted

## Context

A form with a Save button has unsaved changes as a normal state. The editor then asks "Leave without saving?" when a form closes, when another form opens beside the live preview, and when the preview opens another page. A draft is only a file in the working tree ([1](0001-git-is-the-source-of-truth.md)), and Publish is the step that changes the website ([6](0006-one-shared-change-set-and-publish-a-selection.md)), so a save has little risk.

## Decision

- A saved entry and settings save by themselves: after a pause of 0.8 seconds in typing, when the editor leaves a field, and when the form closes. One save runs at a time, with the revision that the form opened, as before.
- The header shows a status, not a Save button: "Saving…", "Saved · not published", "Not saved" with "Try again", or "Not saved: check the fields".
- A value that breaks a rule of the model stays in the form, and the field shows the problem. A save still does not check `required`.
- A conflict with a colleague's save stops the autosave and shows both versions, as before.
- Two steps keep a button, because they have effects beyond the form:
  - A new entry has a "Create" button. Its URL comes from its title, and an autosave while the editor types the title would create and rename it again and again.
  - A new URL waits for "Change URL", with the choice to update the links in other entries. Autosave writes the saved URL until then.
- Leaving a form asks first only for changes that autosave cannot write: a held URL, a field with a problem, a failed save, a conflict. The tab keeps them, as before ([4](0004-sealed-sessions-and-no-state-about-people.md)).

## Consequences

- Colleagues see a change on the Publish page soon after it is typed, also a change that is not finished. Publish still takes a selection.
- The live preview shows a change about a second after the editor stops typing.
- Each autosave is a file write in the working tree and a read of the result. A long rich text is written again at each pause.
- Change this decision when: a site needs a review of each change before others see it.
