import app from 'vinext/server/app-router-entry';
import { applyEventSchedule } from './lib/event-schedule';

type WorkerEnv = { DB: D1Database; ASSETS?: Fetcher };

export default {
  ...app,
  async scheduled(_event: ScheduledController, env: WorkerEnv) {
    await applyEventSchedule(env.DB);
  },
} satisfies ExportedHandler<WorkerEnv>;
