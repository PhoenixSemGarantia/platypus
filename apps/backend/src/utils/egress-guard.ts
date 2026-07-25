import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Core's egress guard for **model-supplied** URLs (ADR-0014).
 *
 * Any tool that fetches a URL the *model* chose — `fetchUrl` today, a Web-search
 * backend's `read_url` next — runs the target through here first. Without it a
 * prompt-injected page can talk the model into fetching cloud-metadata
 * endpoints, loopback services, or internal hosts, all of which the backend
 * process can reach directly.
 *
 * The threat model is a **prompt-injected model**, not a malicious Plugin: a
 * Plugin already runs in-process with `process.env`, the database credentials,
 * and unrestricted egress (ADR-0013), so it never needed `read_url` to reach a
 * metadata service. That is why a pre-flight check is worth having even though
 * it cannot be complete (see the redirect limitation below).
 *
 * The posture is **inverted** from a naive default-deny, because self-hosted and
 * intranet deployments are the point of the Web-search Extension point: reading
 * the internal wiki must keep working, so RFC-1918 is allowed by default and the
 * Operator opts into denying it. What is blocked unconditionally is the set of
 * addresses no legitimate page read targets — loopback (where Platypus's own API
 * and Postgres listen), link-local (AWS/Azure/GCP metadata), and carrier-grade
 * NAT (Alibaba's metadata service lives at `100.100.100.200`).
 *
 * **Known limitations, by design.** This is a *pre-flight* check on the URL the
 * model supplied, so two gaps stay open:
 *
 * 1. **Redirects.** The caller's HTTP client follows them, so a host that passes
 *    here and then 302s into a blocked range is not caught. Closing it would
 *    mean every caller driving redirects manually — rejected for v1 in ADR-0014
 *    as more machinery than the guarantee is worth.
 * 2. **Re-resolution.** `fetch()` resolves the hostname again, independently of
 *    the lookup here, so a name whose records change in between (DNS rebinding)
 *    can be checked as public and fetched as internal. Closing it would mean
 *    pinning the vetted address and connecting to it directly, which breaks TLS
 *    SNI and virtual hosting.
 *
 * Both are why the guard is scoped to a prompt-injected model rather than sold as
 * an SSRF boundary: it removes the easy path, not every path.
 */

export type EgressVerdict =
  { allowed: true } | { allowed: false; reason: string };

/**
 * The single message a blocked fetch reports to the model, whatever the cause.
 * Deliberately uniform: a per-reason message would let a model distinguish "that
 * host does not resolve" from "that host resolves somewhere I may not go", which
 * turns the guard into a probe for internal DNS. The specific reason goes to the
 * server log instead.
 */
export const EGRESS_BLOCKED_MESSAGE =
  "Fetching this URL is not permitted by this deployment's network policy.";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

const ipv4ToInt = (address: string): number | null => {
  const octets = address.split(".");
  if (octets.length !== 4) {
    return null;
  }
  let value = 0;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) {
      return null;
    }
    const parsed = Number(octet);
    if (parsed > 255) {
      return null;
    }
    value = value * 256 + parsed;
  }
  return value >>> 0;
};

/**
 * Expand an IPv6 literal to its 16 bytes. `isIP` has already validated the
 * shape, so the group parsing below cannot see garbage. A zone id (`%eth0`) is
 * dropped — it scopes the address, it does not change which network it is on.
 */
const ipv6ToBytes = (address: string): Uint8Array | null => {
  const withoutZone = address.split("%")[0] ?? "";
  if (isIP(withoutZone) !== 6) {
    return null;
  }
  const elision = withoutZone.indexOf("::");
  const headText = elision === -1 ? withoutZone : withoutZone.slice(0, elision);
  const tailText = elision === -1 ? "" : withoutZone.slice(elision + 2);

  const toGroups = (text: string): number[] => {
    if (!text) {
      return [];
    }
    const groups: number[] = [];
    for (const piece of text.split(":")) {
      // A trailing dotted-quad (`::ffff:169.254.169.254`) occupies two groups.
      if (piece.includes(".")) {
        const embedded = ipv4ToInt(piece);
        if (embedded === null) {
          return [];
        }
        groups.push((embedded >>> 16) & 0xffff, embedded & 0xffff);
      } else {
        groups.push(Number.parseInt(piece, 16));
      }
    }
    return groups;
  };

  const head = toGroups(headText);
  const tail = toGroups(tailText);
  if (head.length + tail.length > 8) {
    return null;
  }
  const groups = [
    ...head,
    ...new Array<number>(8 - head.length - tail.length).fill(0),
    ...tail,
  ];
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = (group >> 8) & 0xff;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
};

/**
 * The IPv4 address embedded in an IPv4-mapped (`::ffff:a9fe:a9fe`) or
 * IPv4-compatible (`::169.254.169.254`) IPv6 address. Unwrapping matters because
 * `isIP` reports these as v6, so the v4 rules would otherwise never see them —
 * `http://[::ffff:a9fe:a9fe]/` reaches the metadata service.
 */
const embeddedIpv4 = (bytes: Uint8Array): number | null => {
  for (let index = 0; index < 10; index += 1) {
    if (bytes[index] !== 0) {
      return null;
    }
  }
  const mapped = bytes[10] === 0xff && bytes[11] === 0xff;
  const compatible = bytes[10] === 0 && bytes[11] === 0;
  if (!mapped && !compatible) {
    return null;
  }
  return (
    ((bytes[12] << 24) | (bytes[13] << 16) | (bytes[14] << 8) | bytes[15]) >>> 0
  );
};

interface V4Rule {
  label: string;
  base: number;
  bits: number;
}

interface V6Rule {
  label: string;
  base: Uint8Array;
  bits: number;
}

const v4Rule = (cidr: string, label: string): V4Rule => {
  const [address, bits] = cidr.split("/");
  const base = ipv4ToInt(address ?? "");
  if (base === null || bits === undefined) {
    throw new Error(`egress-guard: malformed IPv4 CIDR '${cidr}'`);
  }
  return { label, base, bits: Number(bits) };
};

const v6Rule = (cidr: string, label: string): V6Rule => {
  const [address, bits] = cidr.split("/");
  const base = ipv6ToBytes(address ?? "");
  if (base === null || bits === undefined) {
    throw new Error(`egress-guard: malformed IPv6 CIDR '${cidr}'`);
  }
  return { label, base, bits: Number(bits) };
};

const matchesV4 = (value: number, rule: V4Rule): boolean => {
  const mask = rule.bits === 0 ? 0 : (~0 << (32 - rule.bits)) >>> 0;
  return (value & mask) >>> 0 === (rule.base & mask) >>> 0;
};

const matchesV6 = (bytes: Uint8Array, rule: V6Rule): boolean => {
  const wholeBytes = Math.floor(rule.bits / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (bytes[index] !== rule.base[index]) {
      return false;
    }
  }
  const remainingBits = rule.bits % 8;
  if (remainingBits === 0) {
    return true;
  }
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (bytes[wholeBytes] & mask) === (rule.base[wholeBytes] & mask);
};

// Blocked whatever `allowPrivateNetworks` says: nothing a page read legitimately
// targets lives here, and each one is a known SSRF destination.
const ALWAYS_BLOCKED_V4: readonly V4Rule[] = [
  // 0.0.0.0/8 sits with loopback rather than with "reserved": on Linux
  // `http://0.0.0.0:5432/` reaches a service listening on localhost.
  v4Rule("0.0.0.0/8", "this-host range, reaches localhost"),
  v4Rule("127.0.0.0/8", "loopback"),
  v4Rule("169.254.0.0/16", "link-local, hosts cloud metadata services"),
  v4Rule("100.64.0.0/10", "carrier-grade NAT, hosts Alibaba cloud metadata"),
];

const ALWAYS_BLOCKED_V6: readonly V6Rule[] = [
  v6Rule("::/128", "unspecified address"),
  v6Rule("::1/128", "loopback"),
  v6Rule("fe80::/10", "link-local"),
];

// Blocked only when the Operator sets EGRESS_ALLOW_PRIVATE_NETWORKS=false.
// Allowed by default so intranet page reads — the reason the Web-search
// Extension point exists — keep working.
const PRIVATE_V4: readonly V4Rule[] = [
  v4Rule("10.0.0.0/8", "private network"),
  v4Rule("172.16.0.0/12", "private network"),
  v4Rule("192.168.0.0/16", "private network"),
];

const PRIVATE_V6: readonly V6Rule[] = [
  v6Rule("fc00::/7", "unique local address"),
];

/**
 * Why `address` may not be fetched, or `null` when it may. Anything that fails
 * to parse is blocked: an address form this guard does not recognise is an
 * address it cannot vouch for.
 */
const blockReasonFor = (
  address: string,
  allowPrivateNetworks: boolean,
): string | null => {
  const v4Rules = allowPrivateNetworks
    ? ALWAYS_BLOCKED_V4
    : [...ALWAYS_BLOCKED_V4, ...PRIVATE_V4];
  const v6Rules = allowPrivateNetworks
    ? ALWAYS_BLOCKED_V6
    : [...ALWAYS_BLOCKED_V6, ...PRIVATE_V6];

  const family = isIP(address.split("%")[0] ?? "");

  if (family === 4) {
    const value = ipv4ToInt(address);
    if (value === null) {
      return "unparseable IPv4 address";
    }
    return v4Rules.find((rule) => matchesV4(value, rule))?.label ?? null;
  }

  if (family === 6) {
    const bytes = ipv6ToBytes(address);
    if (bytes === null) {
      return "unparseable IPv6 address";
    }
    const v6Match = v6Rules.find((rule) => matchesV6(bytes, rule));
    if (v6Match) {
      return v6Match.label;
    }
    // Fall through to the v4 rules for mapped/compatible forms.
    const embedded = embeddedIpv4(bytes);
    if (embedded !== null) {
      return v4Rules.find((rule) => matchesV4(embedded, rule))?.label ?? null;
    }
    return null;
  }

  return "unrecognised address form";
};

const privateNetworksAllowedByEnv = (): boolean => {
  const raw = process.env.EGRESS_ALLOW_PRIVATE_NETWORKS?.trim().toLowerCase();
  return raw !== "false" && raw !== "0";
};

const resolveHostname = async (hostname: string): Promise<string[]> => {
  const records = await lookup(hostname, { all: true });
  return records.map((record) => record.address);
};

export interface CheckEgressOptions {
  /**
   * Allow RFC-1918 and unique-local addresses. Defaults to the
   * `EGRESS_ALLOW_PRIVATE_NETWORKS` env var (anything but `false`/`0` allows).
   */
  allowPrivateNetworks?: boolean;
  /** Hostname resolver. Injected by tests; defaults to a DNS lookup. */
  resolve?: (hostname: string) => Promise<string[]>;
}

/**
 * Whether a model-supplied URL may be fetched.
 *
 * Hostnames are **resolved** rather than pattern-matched, because the string
 * form of a URL says little about where it goes: `metadata.google.internal` and
 * `169-254-169-254.nip.io` both land on the metadata service while looking
 * ordinary. (Numeric encodings — `http://2852039166/`, `http://0x7f000001/` —
 * need no special handling: WHATWG URL parsing normalises them to dotted quads
 * before this ever sees the hostname.) **Every** resolved address must pass, so
 * a name with one public and one internal record is refused.
 *
 * Fails closed: an unresolvable host is blocked rather than allowed. Such a
 * fetch would fail anyway, so nothing legitimate is lost.
 */
export const checkEgress = async (
  rawUrl: string,
  options: CheckEgressOptions = {},
): Promise<EgressVerdict> => {
  const allowPrivateNetworks =
    options.allowPrivateNetworks ?? privateNetworksAllowedByEnv();
  const resolve = options.resolve ?? resolveHostname;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: `'${rawUrl}' is not a valid URL` };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return {
      allowed: false,
      reason: `scheme '${url.protocol}' is not http or https`,
    };
  }

  // `URL.hostname` keeps the brackets on an IPv6 literal; `isIP` and the DNS
  // resolver both want them gone.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) {
    return { allowed: false, reason: `'${rawUrl}' has no host` };
  }

  let addresses: string[];
  if (isIP(hostname) !== 0) {
    addresses = [hostname];
  } else {
    try {
      addresses = await resolve(hostname);
    } catch (error) {
      return {
        allowed: false,
        reason: `'${hostname}' could not be resolved (${
          error instanceof Error ? error.message : String(error)
        })`,
      };
    }
  }

  if (addresses.length === 0) {
    return { allowed: false, reason: `'${hostname}' resolved to no addresses` };
  }

  for (const address of addresses) {
    const blocked = blockReasonFor(address, allowPrivateNetworks);
    if (blocked) {
      return {
        allowed: false,
        reason: `'${hostname}' resolves to ${address} (${blocked})`,
      };
    }
  }

  return { allowed: true };
};
