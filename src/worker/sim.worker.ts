import { runBatch, type GameRecord, type SimConfig } from '../engine/simulate';

export interface WorkerRequest {
  config: SimConfig;
  start: number;
  count: number;
}

export type WorkerResponse =
  | { type: 'progress'; done: number }
  | { type: 'done'; records: GameRecord[] }
  | { type: 'error'; message: string };

// The DOM lib types `self` as Window; in a worker it is a DedicatedWorkerGlobalScope.
const ctx = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

ctx.onmessage = ({ data }) => {
  try {
    const records = runBatch(data.config, data.start, data.count, (done) => ctx.postMessage({ type: 'progress', done }));
    ctx.postMessage({ type: 'done', records });
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
