import { getConfig } from '../server/config';
import { openConfiguredDatabase } from '../server/db';
const db = await openConfiguredDatabase(getConfig());
await db.close();
console.log('Database migrations applied.');
