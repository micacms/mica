/**
 * Who may edit this site. Every route here is behind `requireAdmin`.
 *
 * These routes manage *memberships*, not accounts. Mica does not create people
 * — an identity provider does that — so inviting someone is recording that the
 * holder of an email address may edit here, and removing them is withdrawing
 * it. Neither touches whether they can sign in to the provider at all, which is
 * the provider's business and deliberately not Mica's.
 *
 * An invited person becomes real on their first sign-in, when the provider
 * tells Mica which subject holds that address. Until then the row is a
 * placeholder with no linked identity, which is exactly what an invitation is.
 */

import { Hono } from "hono";
import { z } from "zod";

import { badRequest, conflict, notFound } from "../lib/errors.js";
import type { Env } from "../http.js";

const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(320),
  name: z.string().trim().max(120).default(""),
  role: z.enum(["admin", "editor"]).default("editor"),
});

const updateSchema = z.object({
  name: z.string().trim().max(120).optional(),
  role: z.enum(["admin", "editor"]).optional(),
});

export function adminUserRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  /**
   * Nobody has vouched for this person yet.
   *
   * An invitation that has been accepted has a linked provider identity; one
   * that has not is still waiting. A user carried over from before OIDC is
   * *also* pending, even with a sign-in date, because their old credential is
   * gone and they have not yet arrived through the provider — which is
   * precisely what an administrator needs to see.
   *
   * In local mode there is no provider, so no identity ever gets linked and
   * the whole distinction is meaningless.
   */
  const isPending = (ctx: Env["Variables"]["ctx"], userId: string): boolean =>
    !ctx.config.authDisabled && ctx.repositories.identities.listForUser(userId).length === 0;

  app.get("/", (c) => {
    const ctx = c.get("ctx");
    const members = ctx.repositories.memberships.listMembers(ctx.siteId);

    return c.json({
      users: members.map((member) => ({
        id: member.userId,
        email: member.email,
        name: member.name,
        role: member.role,
        createdAt: member.createdAt,
        lastLoginAt: member.lastLoginAt,
        /**
         * Whether this person has ever signed in through the provider.
         *
         * The difference between an invitation and a colleague, and worth
         * showing: an invitation that is still pending after a week usually
         * means the address was wrong.
         */
        pending: isPending(ctx, member.userId),
      })),
    });
  });

  app.post("/", async (c) => {
    const ctx = c.get("ctx");
    const parsed = inviteSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message ?? "Invalid details.");
    }

    const { email, name, role } = parsed.data;

    // The person may already exist — as a member of another site, or as an
    // earlier invitation. Reuse the row rather than colliding with it.
    const user =
      ctx.repositories.users.findByEmail(email) ?? ctx.repositories.users.create({ email, name });

    if (ctx.repositories.memberships.find(ctx.siteId, user.id)) {
      throw conflict("That person already has access to this site.");
    }

    ctx.repositories.memberships.grant({ siteId: ctx.siteId, userId: user.id, role });
    c.get("logger").info("Member invited", { userId: user.id, role, by: c.get("user").id });

    return c.json(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          pending: isPending(ctx, user.id),
        },
      },
      201,
    );
  });

  app.patch("/:id", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw badRequest("Invalid details.");

    const membership = ctx.repositories.memberships.find(ctx.siteId, id);
    if (!membership) throw notFound("That person is not a member of this site.");

    // Losing the last administrator would leave nobody able to invite one.
    if (
      parsed.data.role === "editor" &&
      membership.role === "admin" &&
      ctx.repositories.memberships.countAdmins(ctx.siteId) <= 1
    ) {
      throw conflict("There must be at least one administrator.");
    }

    if (parsed.data.role) {
      ctx.repositories.memberships.grant({
        siteId: ctx.siteId,
        userId: id,
        role: parsed.data.role,
      });
    }

    // The name is the provider's to set and is overwritten at each sign-in;
    // editing it here is only useful while an invitation is still pending.
    if (parsed.data.name !== undefined) {
      ctx.repositories.users.update(id, { name: parsed.data.name });
    }

    const user = ctx.repositories.users.findById(id)!;
    const updated = ctx.repositories.memberships.find(ctx.siteId, id)!;

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: updated.role,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        pending: isPending(ctx, user.id),
      },
    });
  });

  /**
   * Removes access to this site.
   *
   * The account itself survives, because it may be a member of another site
   * and because it is the anchor for the provider identity. What goes is the
   * membership — and, immediately, every session that was relying on it.
   */
  app.delete("/:id", (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");

    if (id === c.get("user").id) {
      throw conflict("You cannot remove your own access.");
    }

    const membership = ctx.repositories.memberships.find(ctx.siteId, id);
    if (!membership) throw notFound("That person is not a member of this site.");

    if (
      membership.role === "admin" &&
      ctx.repositories.memberships.countAdmins(ctx.siteId) <= 1
    ) {
      throw conflict("There must be at least one administrator.");
    }

    ctx.repositories.memberships.revoke(ctx.siteId, id);
    ctx.services.sessions.destroyAllForUser(id);
    c.get("logger").info("Member removed", { userId: id, by: c.get("user").id });

    return c.json({ ok: true });
  });

  return app;
}
