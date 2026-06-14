/** Tunable coordinator constants. Kept here so handlers and stores share one source. */
export const POOL = {
  DEFAULT_MAX_URLS: 5, // jobs per lease if device omits maxUrls
  MAX_URLS_CAP: 20, // hard ceiling regardless of device request
  LEASE_TTL_SEC: 300, // visibility timeout: dropped leases reclaim after this
  BACKOFF_BASE_SEC: 3600, // first challenge backoff; doubles per consecutive challenge
  BACKOFF_MAX_SEC: 86_400, // cap backoff at 24h
  DEFAULT_DWELL_MS: 4000, // human-dwell hint sent to the device when URL has none
  REFRESH_INTERVAL_SEC: 86_400, // after a successful fetch, next_due = now + this
  MAX_RESULT_B64_LEN: 12_000_000, // reject result uploads larger than ~12MB of base64 before decoding
  MAX_DOM_BYTES: 25_000_000, // abort decompression if the inflated DOM exceeds ~25MB (decompression-bomb guard)
} as const;
