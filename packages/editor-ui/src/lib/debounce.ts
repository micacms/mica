/** Work that waits for a pause: a burst of keystrokes runs it once. */

export interface Debounced {
  /** Asks for a run. It happens when `wait` ms pass without a new request. */
  (): void;
  /** Runs a waiting request now. Does nothing when no request waits. */
  flush(): void;
  /** Drops a waiting request. */
  cancel(): void;
}

/**
 * Debounces `run`. With `leading`, the first request after a pause runs at
 * once, and the requests that follow within `wait` ms run once at the end.
 */
export function debounce(run: () => void, wait: number, options: { leading?: boolean } = {}): Debounced {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting = false;

  const stop = (): void => {
    clearTimeout(timer);
    timer = undefined;
  };

  const flush = (): void => {
    stop();
    if (!waiting) return;
    waiting = false;
    run();
  };

  const request = (): void => {
    const idle = timer === undefined;
    stop();
    timer = setTimeout(flush, wait);
    if (idle && options.leading) run();
    else waiting = true;
  };

  return Object.assign(request, {
    flush,
    cancel(): void {
      stop();
      waiting = false;
    },
  });
}
