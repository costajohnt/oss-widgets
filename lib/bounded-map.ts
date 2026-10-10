/**
 * Set `key` in `map`, keeping at most `max` entries. Re-setting a key moves it
 * to the newest position; when full, the oldest-inserted entries are evicted.
 * Keeps the per-instance in-memory caches from growing without bound when
 * callers request many distinct usernames or params.
 */
export function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}
