import type { TravelRecord } from '../record.js';

interface Address {
  housenumber?: string;
  street?: string;
  city?: string;
  postcode?: string;
  country?: string;
}

function parseAddress(attributes: string): Address | undefined {
  try {
    const parsed = JSON.parse(attributes) as { address?: unknown };
    const addr = parsed?.address;
    if (addr && typeof addr === 'object') return addr as Address;
    return undefined;
  } catch {
    return undefined;
  }
}

function formatAddress(addr: Address | undefined): string {
  if (!addr) return '';
  const parts = [addr.street, addr.city].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  return parts.join(', ');
}

/**
 * Compose the text embedded into Vectorize for a record:
 * "<name> <category> <street, city>" — address read from the
 * attributes.address OBJECT (snake_case TravelRecord). Empty/malformed
 * address contributes nothing (no "undefined", no trailing comma).
 */
export function composeEmbedText(rec: TravelRecord): string {
  const address = formatAddress(parseAddress(rec.attributes));
  return [rec.name, rec.category, address]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(' ');
}
