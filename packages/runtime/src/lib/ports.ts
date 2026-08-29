/**
 * The port Mica listens on when nobody says otherwise.
 *
 * 6422 is `MICA` on a telephone keypad, which is the only reason anybody will
 * remember it. What matters more is what it is not: 3000, 4000, 4173, 4200,
 * 4321, 5000, 5173, 8000, 8080 and 1313 all belong to something a developer is
 * likely to be running beside Mica — Astro's dev server most of all — and IANA
 * has 6420 and 6421 assigned but not 6422, so nothing on the machine is
 * expected to want it.
 *
 * A port collision is a bad first minute: the command fails, and the reason is
 * somebody else's software. Picking an unfashionable number is the whole fix.
 */
export const DEFAULT_PORT = 6422;

/** The address the CLI prints and the browser opens. */
export const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}`;
