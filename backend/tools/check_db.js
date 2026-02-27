const { MongoClient } = require('mongodb');

const MONGO_URI = 'mongodb://127.0.0.1:27017';
const DB_NAME = 'thumbnail_linter';

async function main() {
    const client = new MongoClient(MONGO_URI);
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const runs = await db.collection('runs')
            .find({})
            .sort({ createdAt: -1 })
            .limit(5)
            .toArray();

        console.log("=== LATEST 5 RUNS ===");
        runs.forEach(r => {
            console.log(`\nID: ${r._id}`);
            console.log(`Time: ${r.createdAt}`);
            console.log(`Mode: ${r.mode}`);
            console.log(`Status: ${r.status}`);
            if (r.error) console.log(`Error: ${JSON.stringify(r.error)}`);
            if (r.stages) {
                console.log(`Stages: ${Object.keys(r.stages).join(', ')}`);
                if (r.stages.cv) console.log(`CV Status: ${r.stages.cv.status}`);
            }
        });

    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}

main();
