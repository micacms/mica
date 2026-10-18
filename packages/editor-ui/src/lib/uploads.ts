/**
 * Uploads of many files: one request for each file, one after another, as the
 * server takes them. A file that fails does not stop the others.
 */

type UploadStatus = "waiting" | "uploading" | "done" | "failed";

export interface UploadState {
  name: string;
  status: UploadStatus;
  /** Why the file failed. */
  message?: string;
}

export interface UploadRun<T> {
  /** What the server gave back, in the order of the files. */
  done: T[];
  /** The files to send again. */
  failed: File[];
}

/** Sends each file with `send`, and reports the state of every file after each step. */
export async function uploadEach<T>(
  files: readonly File[],
  send: (file: File) => Promise<T>,
  onChange: (states: UploadState[]) => void,
  messageOf: (error: unknown) => string = () => "The upload failed.",
): Promise<UploadRun<T>> {
  const states: UploadState[] = files.map((file) => ({ name: file.name, status: "waiting" }));
  const run: UploadRun<T> = { done: [], failed: [] };
  const report = () => onChange(states.map((state) => ({ ...state })));
  report();
  for (const [index, file] of files.entries()) {
    states[index] = { name: file.name, status: "uploading" };
    report();
    try {
      run.done.push(await send(file));
      states[index] = { name: file.name, status: "done" };
    } catch (error) {
      run.failed.push(file);
      states[index] = { name: file.name, status: "failed", message: messageOf(error) };
    }
    report();
  }
  return run;
}

/**
 * The paths with the new ones added in their order: without a path that is
 * already there, and without more than `max`. `skipped` counts the new paths
 * that did not fit.
 */
export function addPaths(paths: readonly string[], added: readonly string[], max?: number): { next: string[]; skipped: number } {
  const next = [...paths];
  let skipped = 0;
  for (const path of added) {
    if (next.includes(path)) continue;
    if (max !== undefined && next.length >= max) skipped++;
    else next.push(path);
  }
  return { next, skipped };
}

/** How many more files a field takes: all of them without `max`. */
export const roomFor = (count: number, max?: number): number => (max === undefined ? Infinity : Math.max(0, max - count));
