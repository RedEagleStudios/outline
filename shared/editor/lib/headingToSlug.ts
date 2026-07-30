import escape from "lodash/escape";
import type { Node } from "prosemirror-model";
import slugify from "slugify";

const cache = new Map<string, string>();

// Slugify, escape, and remove periods from headings so that they are
// compatible with both url hashes AND dom ID's (querySelector does not like
// ID's that begin with a number or a period, for example).
function safeSlugify(text: string) {
  const cached = cache.get(text);
  if (cached) {
    return cached;
  }

  const slug = `h-${escape(
    slugify(text, {
      remove: /[!"#$%&'\.()*+,\/:;<=>?@\[\]\\^_`{|}~]/g,
      lower: true,
    })
  )}`;

  cache.set(text, slug);
  return slug;
}

/**
 * Calculates a heading slug based on its text and duplicate index.
 *
 * @param node the heading node.
 * @param index the zero-based occurrence among headings with the same slug.
 * @returns the URL-safe heading slug.
 */
export default function headingToSlug(node: Node, index = 0): string {
  const slugified = safeSlugify(node.textContent);
  if (index === 0) {
    return slugified;
  }
  return `${slugified}-${index}`;
}

/**
 * Calculates the browser-storage key for a heading fold preference.
 *
 * @param node the heading node.
 * @param id the document identifier.
 * @param index the zero-based occurrence among headings with the same slug.
 * @returns the browser-storage persistence key.
 */
export function headingToPersistenceKey(
  node: Node,
  id?: string,
  index = 0
): string {
  const slug = headingToSlug(node, index);
  const documentKey =
    id || (typeof window !== "undefined" ? window.location.pathname : "");
  return `rme-${documentKey}–${slug}`;
}
