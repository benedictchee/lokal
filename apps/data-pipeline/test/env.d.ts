declare module 'cloudflare:test' {
  interface ProvidedEnv {
    GROUPS: D1Database;
    DATA: R2Bucket;
  }
}

declare module '*.sql?raw' {
  const s: string;
  export default s;
}

declare module '*.json?raw' {
  const s: string;
  export default s;
}
