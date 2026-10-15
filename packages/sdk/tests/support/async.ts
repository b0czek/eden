export function gate<T = void>() {
  let release!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, fail) => {
    release = resolve;
    reject = fail;
  });
  return { promise, release, reject };
}

export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
