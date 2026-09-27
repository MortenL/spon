/** Settles like `work`, unless `ms` pass first: then runs `onTimeout` and rejects with Error(`message`). */
export function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => void, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(message));
    }, ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}
