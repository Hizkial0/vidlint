/**
 * Local Test Harness DB Layer (MongoDB)
 * 
 * Schema: 'runs' collection
 * One document per image analysis run.
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'v3';

let client;
let db;
let connectionPromise = null;

async function connectDB() {
    if (db) return db;
    if (connectionPromise) return connectionPromise;

    connectionPromise = (async () => {
        try {
            console.log(`[DB] Connecting to ${MONGO_URI}/${DB_NAME}...`);
            client = new MongoClient(MONGO_URI);
            await client.connect();
            db = client.db(DB_NAME);

            // Ensure Indexes
            const runs = db.collection('runs');
            await runs.createIndex({ createdAt: -1 });
            await runs.createIndex({ status: 1, createdAt: -1 });
            await runs.createIndex({ "stages.cheap.status": 1, createdAt: -1 });
            await runs.createIndex({ "stages.final.status": 1, createdAt: -1 });

            console.log(`[DB] Connected & Indexed.`);
            return db;
        } catch (err) {
            console.error(`[DB] Connection Failed:`, err);
            connectionPromise = null; // Reset on failure
            throw err;
        }
    })();

    return connectionPromise;
}

/**
 * Start a new run document
 */
async function createRun({ imageUrl, mode, tags, promptVersions, context, source }) {
    if (!db) await connectDB();

    const doc = {
        imageUrl,
        mode: mode || 'debug',
        source: source || 'unknown',
        context: context || {},
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'running',
        stages: {},
        meta: {
            tags: tags || [],
            promptVersions: promptVersions || {}
        }
    };

    const result = await db.collection('runs').insertOne(doc);
    return result.insertedId.toString();
}

/**
 * Log a stage result (Atomic Update)
 */
async function logStage(runId, stageName, { status, result, debug, error }) {
    if (!db) await connectDB();

    const updatePath = `stages.${stageName}`;
    const updateDoc = {
        [`${updatePath}.status`]: status,
        [`${updatePath}.at`]: new Date(),
        updatedAt: new Date(),
        lastStage: stageName
    };

    if (result) updateDoc[`${updatePath}.result`] = result;
    if (debug) updateDoc[`${updatePath}.debug`] = debug;
    if (error) updateDoc[`${updatePath}.error`] = error;

    await db.collection('runs').updateOne(
        { _id: new ObjectId(runId) },
        { $set: updateDoc }
    );
}

/**
 * Complete the run (Success)
 */
async function completeRun(runId, result) {
    if (!db) await connectDB();

    await db.collection('runs').updateOne(
        { _id: new ObjectId(runId) },
        {
            $set: {
                status: 'ok',
                result,
                completedAt: new Date(),
                updatedAt: new Date()
            }
        }
    );
}

/**
 * Fail the run (Error)
 */
async function failRun(runId, err) {
    if (!db) await connectDB();

    await db.collection('runs').updateOne(
        { _id: new ObjectId(runId) },
        {
            $set: {
                status: 'failed',
                error: {
                    message: err?.message || 'unknown',
                    code: err?.code || null,
                    stage: err?.stage || null,
                    stack: err?.stack
                },
                completedAt: new Date(),
                updatedAt: new Date()
            }
        }
    );
}

// Alias for backward compatibility if needed, but strict refactor prefers strict naming
const finalizeRun = completeRun;

async function getRun(runId) {
    if (!db) await connectDB();
    return await db.collection('runs').findOne({ _id: new ObjectId(runId) });
}

async function listRuns(limit = 50) {
    if (!db) await connectDB();
    return await db.collection('runs')
        .find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
}

module.exports = {
    connectDB,
    createRun,
    logStage,
    finalizeRun, // Deprecated but kept to avoid breaking old imports if any remain
    completeRun,
    failRun,
    getRun,
    listRuns
};
