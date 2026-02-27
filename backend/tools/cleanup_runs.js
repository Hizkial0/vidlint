
require('dotenv').config({ path: '../.env' });
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'thumbnail_linter';

async function cleanup() {
    const client = new MongoClient(MONGO_URI);
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const runs = db.collection('runs');

        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

        const result = await runs.updateMany(
            { status: "running", createdAt: { $lt: tenMinutesAgo } },
            {
                $set: {
                    status: "failed",
                    error: { message: "stale_run_auto_closed" },
                    completedAt: new Date()
                }
            }
        );

        console.log(`Cleanup complete. Closed ${result.modifiedCount} stale runs.`);
    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}

cleanup();
