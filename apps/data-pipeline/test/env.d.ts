declare module 'cloudflare:test' {
  interface ProvidedEnv {
    GROUPS: D1Database;
  }
}

declare module '*.sql?raw' {
  const s: string;
  export default s;
}
