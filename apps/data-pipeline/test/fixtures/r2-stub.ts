// Minimal in-memory R2Bucket double for analytics-smoke (Task 10).
// Implements only put/get; NdjsonR2LakeWriter writes gz NDJSON via put().

export interface StoredObject {
  body: Uint8Array;
}

/** Coerce whatever NdjsonR2LakeWriter hands to put() into raw bytes. */
async function toBytes(
  value: ReadableStream | ArrayBuffer | ArrayBufferView | Blob | string,
): Promise<Uint8Array> {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  // ReadableStream (e.g. gzip CompressionStream output)
  const reader = (value as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export class InMemoryR2Bucket {
  readonly objects = new Map<string, StoredObject>();

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | Blob | string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _opts?: any,
  ): Promise<{ key: string }> {
    this.objects.set(key, { body: await toBytes(value) });
    return { key };
  }

  async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    const bytes = obj.body;
    return {
      async arrayBuffer() {
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
      },
    };
  }

  keys(): string[] {
    return [...this.objects.keys()];
  }
}
