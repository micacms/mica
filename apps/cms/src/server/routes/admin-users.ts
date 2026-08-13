/**
 * User administration. Every route here is behind `requireAdmin`.
 *
 * There is no self-service password reset by design (§9.1 allows either):
 * an administrator assigns a temporary password and the editor is forced to
 * change it at next sign-in. No mail server, no reset-token lifetime to get
 * wrong.
 */

import { Hono } from "hono";
import { z } from "zod";

import { badRequest, conflict, notFound } from "../lib/errors.js";
import type { Env } from "../http.js";
import { toPublicUser } from "../repositories/users.js";
import { checkPasswordStrength, hashPassword } from "../services/password.js";

const createSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(320),
  name: z.string().trim().max(120).default(""),
  role: z.enum(["admin", "editor"]).default("editor"),
  password: z.string().min(1).max(200),
});

const updateSchema = z.object({
  email: z.string().trim().email().max(320).optional(),
  name: z.string().trim().max(120).optional(),
  role: z.enum(["admin", "editor"]).optional(),
});

const passwordSchema = z.object({ password: z.string().min(1).max(200) });

export function adminUserRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  app.get("/", (c) => {
    const users = c.get("ctx").repositories.users.list().map(toPublicUser);
    return c.json({ users });
  });

  app.post("/", async (c) => {
    const ctx = c.get("ctx");
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message ?? "Invalid user details.");
    }

    const { email, name, role, password } = parsed.data;

    const problem = checkPasswordStrength(password);
    if (problem) throw badRequest(problem);

    if (ctx.repositories.users.findByEmail(email)) {
      throw conflict("An account with that email address already exists.");
    }

    const user = ctx.repositories.users.create({
      email,
      name,
      role,
      passwordHash: await hashPassword(password),
      // The administrator knows this password, so it cannot stay in use.
      mustChangePassword: true,
    });

    c.get("logger").info("User created", { userId: user.id, role });
    return c.json({ user: toPublicUser(user) }, 201);
  });

  app.patch("/:id", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw badRequest("Invalid user details.");

    const target = ctx.repositories.users.findById(id);
    if (!target) throw notFound("This account no longer exists.");

    if (parsed.data.email) {
      const clash = ctx.repositories.users.findByEmail(parsed.data.email);
      if (clash && clash.id !== id) {
        throw conflict("Another account already uses that email address.");
      }
    }

    // Losing the last administrator would lock everyone out of user management.
    if (
      parsed.data.role === "editor" &&
      target.role === "admin" &&
      ctx.repositories.users.countAdmins() <= 1
    ) {
      throw conflict("There must be at least one administrator.");
    }

    return c.json({ user: toPublicUser(ctx.repositories.users.update(id, parsed.data)!) });
  });

  app.post("/:id/password", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");
    const parsed = passwordSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw badRequest("Provide a new password.");

    const problem = checkPasswordStrength(parsed.data.password);
    if (problem) throw badRequest(problem);

    if (!ctx.repositories.users.findById(id)) throw notFound("This account no longer exists.");

    ctx.repositories.users.update(id, {
      passwordHash: await hashPassword(parsed.data.password),
      mustChangePassword: true,
    });

    // The old password is gone; every session for that account goes with it.
    ctx.services.sessions.destroyAllForUser(id);
    c.get("logger").info("Password reset by administrator", {
      userId: id,
      by: c.get("user").id,
    });

    return c.json({ ok: true });
  });

  app.delete("/:id", (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");

    if (id === c.get("user").id) {
      throw conflict("You cannot delete your own account.");
    }

    const target = ctx.repositories.users.findById(id);
    if (!target) throw notFound("This account no longer exists.");

    if (target.role === "admin" && ctx.repositories.users.countAdmins() <= 1) {
      throw conflict("There must be at least one administrator.");
    }

    ctx.services.sessions.destroyAllForUser(id);
    ctx.repositories.users.delete(id);
    c.get("logger").info("User deleted", { userId: id, by: c.get("user").id });

    return c.json({ ok: true });
  });

  return app;
}
