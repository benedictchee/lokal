/** Tunable coordinator constants. Kept here so handlers and stores share one source. */
export const POOL = {
  DEFAULT_MAX_URLS: 5, // jobs per lease if device omits maxUrls
  MAX_URLS_CAP: 20, // hard ceiling regardless of device request
  LEASE_TTL_SEC: 300, // visibility timeout: dropped leases reclaim after this
  BACKOFF_BASE_SEC: 3600, // first challenge backoff; doubles per consecutive challenge
  BACKOFF_MAX_SEC: 86_400, // cap backoff at 24h
  DEFAULT_DWELL_MS: 4000, // human-dwell hint sent to the device when URL has none
  REFRESH_INTERVAL_SEC: 86_400, // after a successful fetch, next_due = now + this
} as const;
