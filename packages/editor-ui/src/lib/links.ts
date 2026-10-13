/** Link addresses that rich text accepts. */

const ALLOWED = /^(https?:\/\/\S+|mailto:\S+|tel:\S+|\/\S*)$/i;

/** Why an address cannot be a link, or null when it can. */
export function linkProblem(href: string): string | null {
  if (ALLOWED.test(href.trim())) return null;
  return "Start the address with https://, http://, mailto:, tel: or /.";
}
