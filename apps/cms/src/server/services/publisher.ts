/**
 * Publishing.
 *
 * The CMS deliberately knows nothing about where the public site is hosted. It
 * emits a signed webhook and stops there, which is what keeps GitHub, GitLab,
 * Vercel, Netlify, Cloudflare and a self-hosted runner equally supported.
 *
 * Deliveries are coalesced: an editor publishing six entries in a minute should
 * produce one build, not six.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Logger } from "../lib/logger.js";

export type PublishEventType =
  | "entry.published"
  | "entry.unpublished"
  | "entry.updated"
  | "entry.deleted"
  | "global.updated"
  | "manual";

export interface PublishEvent {
  type: PublishEventType;
  collection?: string;
  slug?: string;
  entryId?: string;
  global?: string;
  actor?: { id: string; email: string } | null;
  at?: string;
}

export interface DeliveryStatus {
  /** Events waiting for the debounce window to close. */
  pending: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  configured: boolean;
}

export interface Publisher {
  publish(event: PublishEvent): Promise<void>;
  /** Sends any queued events immediately. Used on shutdown and by "Rebuild now". */
  flush(): Promise<void>;
  status(): DeliveryStatus;
}

export const SIGNATURE_HEADER = "x-mica-signature";
export const TIMESTAMP_HEADER = "x-mica-timestamp";

/**
 * Signs `<timestamp>.<body>` rather than the body alone, so a captured request
 * cannot be replayed later against a receiver that checks the timestamp.
 */
export function signPayload(body: string, timestamp: string, secret: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** Receiver-side helper, exported for the reference CI script and the tests. */
export function verifySignature(options: {
  body: string;
  timestamp: string;
  signature: string;
  secret: string;
  toleranceSeconds?: number;
}): boolean {
  const age = Math.abs(Date.now() - Number(options.timestamp) * 1000);
  if (!Number.isFinite(age) || age > (options.toleranceSeconds ?? 300) * 1000) return false;

  const expected = Buffer.from(signPayload(options.body, options.timestamp, options.secret));
  const received = Buffer.from(options.signature);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export interface WebhookOptions {
  url: string;
  secret?: string;
  /** Quiet period before a batch is sent. */
  debounceMs?: number;
  /** Upper bound on how long an event waits, however busy the editor is. */
  maxDelayMs?: number;
  attempts?: number;
  timeoutMs?: number;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

export function webhook(options: WebhookOptions): Publisher {
  const debounceMs = options.debounceMs ?? 10_000;
  const maxDelayMs = options.maxDelayMs ?? 60_000;
  const attempts = options.attempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const doFetch = options.fetchImpl ?? fetch;
  const logger = options.logger;

  let queue: PublishEvent[] = [];
  let timer: NodeJS.Timeout | null = null;
  let firstQueuedAt = 0;
  let inFlight: Promise<void> | null = null;

  const status: DeliveryStatus = {
    pending: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    configured: true,
  };

  const send = async (events: PublishEvent[]): Promise<void> => {
    const body = JSON.stringify({
      source: "mica-cms",
      deliveredAt: new Date().toISOString(),
      events,
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "mica-cms/1.0",
      [TIMESTAMP_HEADER]: timestamp,
    };
    if (options.secret) {
      headers[SIGNATURE_HEADER] = signPayload(body, timestamp, options.secret);
    }

    for (let attempt = 1; attempt <= attempts; attempt++) {
      status.lastAttemptAt = new Date().toISOString();
      try {
        const response = await doFetch(options.url, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (response.ok) {
          status.lastSuccessAt = new Date().toISOString();
          status.lastError = null;
          logger?.info("Build webhook delivered", {
            events: events.length,
            status: response.status,
          });
          return;
        }

        // 4xx other than 429 will not succeed on retry.
        const retryable = response.status === 429 || response.status >= 500;
        status.lastError = `HTTP ${response.status}`;
        if (!retryable) {
          logger?.error("Build webhook rejected", { status: response.status });
          return;
        }
      } catch (error) {
        status.lastError = error instanceof Error ? error.message : String(error);
      }

      if (attempt < attempts) {
        const backoff = 1000 * 2 ** (attempt - 1);
        logger?.warn("Build webhook failed, retrying", {
          attempt,
          backoff,
          error: status.lastError,
        });
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }

    logger?.error("Build webhook gave up", { attempts, error: status.lastError });
  };

  const drain = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (queue.length === 0) return;

    const batch = queue;
    queue = [];
    firstQueuedAt = 0;
    status.pending = 0;

    // Chain onto any delivery already running so batches arrive in order.
    inFlight = (inFlight ?? Promise.resolve()).then(() => send(batch));
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);

    const waited = firstQueuedAt === 0 ? 0 : Date.now() - firstQueuedAt;
    const delay = Math.max(0, Math.min(debounceMs, maxDelayMs - waited));

    timer = setTimeout(drain, delay);
    // A pending build must never hold the process open on shutdown.
    timer.unref?.();
  };

  return {
    async publish(event) {
      queue.push({ ...event, at: event.at ?? new Date().toISOString() });
      status.pending = queue.length;
      if (firstQueuedAt === 0) firstQueuedAt = Date.now();
      schedule();
    },

    async flush() {
      drain();
      await inFlight;
    },

    status() {
      return { ...status };
    },
  };
}

/** Used when BUILD_WEBHOOK_URL is unset: publishing still works, no build runs. */
export function noopPublisher(logger?: Logger): Publisher {
  return {
    async publish(event) {
      logger?.debug("No build webhook configured; skipping", { type: event.type });
    },
    async flush() {},
    status() {
      return {
        pending: 0,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastError: null,
        configured: false,
      };
    },
  };
}
