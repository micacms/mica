/**
 * Reads the flattened format of `devalue`, which Astro uses for
 * `.astro/data-store.json`: a JSON array whose first item is the root, and in
 * which every other value refers to items by their index. Only what Astro
 * writes is read: objects, arrays, Map, Set, Date and the special numbers.
 */

const SPECIAL: Record<number, unknown> = {
  [-1]: undefined,
  [-2]: undefined, // a hole in an array
  [-3]: Number.NaN,
  [-4]: Number.POSITIVE_INFINITY,
  [-5]: Number.NEGATIVE_INFINITY,
  [-6]: -0,
};

export function unflatten(flat: unknown[]): unknown {
  const done = new Map<number, unknown>();

  const value = (index: number): unknown => {
    if (index < 0) return SPECIAL[index];
    if (done.has(index)) return done.get(index);
    const item = flat[index];

    if (Array.isArray(item)) {
      if (typeof item[0] === "string") {
        const [type, ...rest] = item as [string, ...unknown[]];
        if (type === "Date") return keep(index, new Date(rest[0] as string));
        if (type === "Map") {
          const map = keep(index, new Map<unknown, unknown>());
          for (let i = 0; i < rest.length; i += 2) map.set(value(rest[i] as number), value(rest[i + 1] as number));
          return map;
        }
        if (type === "Set") {
          const set = keep(index, new Set<unknown>());
          for (const entry of rest) set.add(value(entry as number));
          return set;
        }
        if (type === "null") {
          const object = keep(index, Object.create(null) as Record<string, unknown>);
          for (let i = 0; i < rest.length; i += 2) object[rest[i] as string] = value(rest[i + 1] as number);
          return object;
        }
        throw new Error(`The data store holds a value of type "${type}", which this version of Mica cannot read.`);
      }
      const array = keep(index, [] as unknown[]);
      for (const entry of item as number[]) array.push(value(entry));
      return array;
    }

    if (item !== null && typeof item === "object") {
      const object = keep(index, {} as Record<string, unknown>);
      for (const [key, entry] of Object.entries(item as Record<string, number>)) object[key] = value(entry);
      return object;
    }

    return keep(index, item);
  };

  function keep<T>(index: number, result: T): T {
    done.set(index, result);
    return result;
  }

  return value(0);
}
