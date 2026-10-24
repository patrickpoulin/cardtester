import type { GameRecord, SimConfig } from './engine/simulate';
import type { WorkerRequest, WorkerResponse } from './worker/sim.worker';

/** Splits a run across one Web Worker per CPU core and reports overall progress. */
export function runInWorkers(
  config: SimConfig,
  numGames: number,
  onProgress: (done: number) => void,
): Promise<GameRecord[]> {
  const workerCount = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, Math.ceil(numGames / 50)));
  const chunk = Math.ceil(numGames / workerCount);
  const done = new Array(workerCount).fill(0);
  const workers: Worker[] = [];

  const jobs = Array.from({ length: workerCount }, (_, i) => {
    const start = i * chunk;
    const count = Math.max(0, Math.min(chunk, numGames - start));
    return new Promise<GameRecord[]>((resolve, reject) => {
      if (count === 0) return resolve([]);
      const worker = new Worker(new URL('./worker/sim.worker.ts', import.meta.url), { type: 'module' });
      workers.push(worker);
      worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.type === 'progress') {
          done[i] = data.done;
          onProgress(done.reduce((a, b) => a + b, 0));
        } else if (data.type === 'done') {
          resolve(data.records);
        } else {
          reject(new Error(data.message));
        }
      };
      worker.onerror = (e) => reject(new Error(e.message || 'Simulation worker crashed'));
      worker.postMessage({ config, start, count } satisfies WorkerRequest);
    });
  });

  return Promise.all(jobs)
    .then((chunks) => chunks.flat())
    .finally(() => workers.forEach((w) => w.terminate()));
}
