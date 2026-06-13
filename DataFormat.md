# Data Format & Inter-Subsystem Protocol

This program uses **one centralized schema** and **one RPC protocol** across
every subsystem. This document is the contract.

## The two rules

1. **Protocol Buffers are the single source of truth for all data exchanged
   between subsystems.** Every message that crosses a subsystem boundary is
   defined once, in `proto/`. No subsystem invents its own ad-hoc JSON shape for
   shared data.
2. **The Connect protocol (connectrpc.com) is how subsystems talk.** Every RPC
   between two subsystems is a Connect call against a service defined in
   `proto/`.

## Why Connect (and not raw gRPC)

Connect runs over plain HTTP/1.1 and HTTP/2, supports both binary Protobuf and
JSON payloads, and needs no HTTP/2 trailers. That makes it work where raw gRPC
struggles:

- **Cloudflare Workers** — Connect servers are ordinary `fetch` handlers, so
  they run on the Workers runtime with no special infrastructure.
- **Flutter / browsers** — first-class clients exist; no gRPC proxy needed.
- **Debuggability** — any endpoint can be hit with `curl` using the JSON
  content type.

## Toolchain

| Concern | Tool |
|---------|------|
| Schema management, lint, breaking-change detection | [Buf](https://buf.build) (`buf lint`, `buf breaking`) |
| Code generation | `buf generate` (config in `proto/buf.gen.yaml`) |
| TypeScript messages | [`@bufbuild/protobuf`](https://github.com/bufbuild/protobuf-es) (protobuf-es) |
| TypeScript RPC (client + server) | [`@connectrpc/connect`](https://github.com/connectrpc/connect-es) (connect-es) |
| TS server on Workers | connect-es universal `fetch` handler, e.g. via [`@depot/connectrpc-workers`](https://github.com/depot/connectrpc-workers) |
| Dart messages | `protoc-gen-dart` |
| Dart RPC (client) | [`connectrpc`](https://pub.dev/packages/connectrpc) (connect-dart) |

## Who is a client, who is a server

| Subsystem | Role | Connect implementation |
|-----------|------|------------------------|
| `consumer-app` (Flutter) | Client | connect-dart → calls `consumer-api` |
| `merchant-web` (Next.js) | Client | connect-es → calls `merchant-api` |
| `consumer-api` (Worker) | Server (+ client of internal services) | connect-es |
| `merchant-api` (Worker) | Server | connect-es |
| `data-pipeline` (Worker) | Server (for AI/retrieval) + scheduled producer | connect-es |

Worker→Worker calls may travel over Cloudflare **service bindings** as the
transport while still speaking the **Connect protocol** for the message
contract — the schema discipline is identical regardless of transport.

## Schema conventions

- **Package naming:** `travel.<domain>.v<n>` (e.g. `travel.commerce.v1`). Each
  domain is versioned independently.
- **Versioning:** evolve schemas backward-compatibly. Breaking changes require a
  new version package (`v2`), never an edit to an existing released one.
  `buf breaking` runs in CI against the previous state to enforce this.
- **No reused field numbers.** Removed fields are `reserved`.
- **Wire format:** `application/proto` (binary) for service-to-service traffic;
  `application/json` available for debugging and browser clients.
- **Errors:** map domain errors to Connect error codes in `packages/shared`, so
  every subsystem reports failures the same way.

## Generation flow

```
proto/ ──(buf generate)──┬──> packages/proto-ts/   (consumed by all TS apps)
                         └──> packages/proto-dart/  (path dep of consumer-app)
```

`buf generate` is the only way generated code is produced. CI runs `buf lint`
and `buf breaking` on every change to `proto/`. Generated output is never edited
by hand.
