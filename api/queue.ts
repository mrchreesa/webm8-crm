import { queue, runHostedCycle } from '../server/jobs.js';
import { getRuntime } from '../server/runtime.js';

export default queue.handleNodeCallback(
  async (message: { version: number }) => {
    if (message.version !== 1) throw new Error('Unsupported job version.');
    const { db, cfg } = await getRuntime();
    await runHostedCycle(db, cfg);
  },
  {
    retry: (_error, metadata) => ({
      afterSeconds: Math.min(21600, 30 * 2 ** Math.min(metadata.deliveryCount - 1, 10)),
    }),
  },
);
