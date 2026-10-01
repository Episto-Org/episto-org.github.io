// Which detail file a paper lives in: the first two hex digits of the
// FNV-1a hash of its id. Shared by the build and the paper page.

export function shardOf(id) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(id)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 24).toString(16).padStart(2, '0');
}
