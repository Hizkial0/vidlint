const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'v3';

async function listRequests() {
    const client = new MongoClient(MONGO_URI);
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const requests = await db.collection('pro_requests').find({}).sort({ createdAt: -1 }).toArray();

        console.log('\n--- PRO ACCESS REQUESTS (MongoDB) ---\n');
        if (requests.length === 0) {
            console.log('No requests found.');
        } else {
            console.table(requests.map(r => ({
                Name: r.name,
                Email: r.email,
                Channel: r.channel,
                Status: r.status,
                Date: new Date(r.createdAt).toLocaleString()
            })));
        }
        console.log('\n------------------------------------\n');
    } catch (err) {
        console.error('Failed to list requests:', err.message);
    } finally {
        await client.close();
    }
}

listRequests();
