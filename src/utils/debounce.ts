export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: number | undefined;
  return ((...args: Parameters<T>) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  }) as T;
}
