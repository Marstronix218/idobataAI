import { isIP } from "node:net";

type Environment = Record<string, string | undefined>;

/**
 * The client address to rate limit an unauthenticated request by, as a key,
 * or null when no header can be trusted for it.
 *
 * Next.js no longer exposes `request.ip`; the host supplies the address in
 * headers, and only the host's own headers can be trusted:
 * - On Vercel (VERCEL is set): `x-vercel-forwarded-for`, then
 *   `x-forwarded-for` and `x-real-ip`, which Vercel overwrites so a client
 *   cannot spoof them.
 * - Elsewhere: only the header named by CLIENT_IP_HEADER (for example
 *   `x-real-ip` behind an nginx that sets it), and only its first entry.
 * - Otherwise null. The caller then applies a coarse shared limit instead of
 *   putting every such request in one per-address bucket that one client could
 *   exhaust for everybody.
 *
 * IPv4 keys are `ip:<address>`. IPv6 keys cover the /64, since one client
 * usually controls a whole /64: `ip6:<first four groups>::/64`. An
 * IPv4-mapped IPv6 address counts as its IPv4 address. Anything that is not a
 * valid address is ignored, so a header cannot inject an arbitrary key.
 */
export function clientRateKey(request: Request, env: Environment = process.env): string | null {
  const first = (name: string) => request.headers.get(name)?.split(",")[0];
  const candidates = env.VERCEL
    ? [first("x-vercel-forwarded-for"), first("x-forwarded-for"), first("x-real-ip")]
    : env.CLIENT_IP_HEADER?.trim() ? [first(env.CLIENT_IP_HEADER.trim().toLowerCase())] : [];
  for (const candidate of candidates) {
    const key = addressKey(candidate?.trim() ?? "");
    if (key) return key;
  }
  return null;
}

function addressKey(address: string): string | null {
  const version = isIP(address);
  if (version === 4) return `ip:${address}`;
  if (version !== 6) return null;
  const groups = ipv6Groups(address);
  if (!groups) return null;
  // ::ffff:a.b.c.d
  if (groups.slice(0, 5).every((group) => group === "0") && groups[5] === "ffff") {
    const high = Number.parseInt(groups[6], 16);
    const low = Number.parseInt(groups[7], 16);
    return `ip:${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return `ip6:${groups.slice(0, 4).join(":")}::/64`;
}

/** The eight groups of an IPv6 address, lowercase without leading zeros, or null. */
function ipv6Groups(address: string): string[] | null {
  let host: string;
  try {
    // The URL parser validates and canonicalises IPv6 (lowercase, compressed,
    // embedded IPv4 as hex) and rejects zone ids.
    host = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const [head, tail] = host.includes("::") ? host.split("::") : [host, undefined];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  return groups.length === 8 ? groups : null;
}
