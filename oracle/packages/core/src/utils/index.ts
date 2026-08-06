// Plain "crypto", not "node:crypto": this package is bundled into the web app
// via transpilePackages, and webpack cannot resolve the node: scheme.
import { createHash, randomUUID } from "crypto";

export function generateId(): string {
  return randomUUID();
}

export function now(): Date {
  return new Date();
}

export function hashData(data: unknown): string {
  // Uses the module-level import rather than require(): this file already
  // imports from node:crypto, and the require() form would throw the moment
  // this package is built as ESM — taking proof hashing down with it.
  const json = JSON.stringify(data, (_, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
  return createHash("sha256").update(json).digest("hex");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function groupBy<T, K extends string | number | symbol>(
  array: T[],
  keyFn: (item: T) => K
): Record<K, T[]> {
  return array.reduce(
    (acc, item) => {
      const key = keyFn(item);
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    },
    {} as Record<K, T[]>
  );
}
