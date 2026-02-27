require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
const sharp = require('sharp');
const { connectDB } = require('../db');
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function checkEmbeddingServerHealth() {
    try {
        const res = await fetch('http://127.0.0.1:8000/health');
        if (!res.ok) {
            throw new Error(`Embedding server returned ${res.status}`);
        }
        const data = await res.json();
        console.log(`[Health] Embedding API is online. Model: ${data.model}, Device: ${data.device}`);
    } catch (err) {
        console.error(`\n[FATAL] Embedding server is NOT reachable on http://127.0.0.1:8000.`);
        console.error(`Please ensure the local Python FastAPI server is running before executing this script.`);
        console.error(`Details: ${err.message}\n`);
        process.exit(1);
    }
}

// --- Configuration ---
const SNAPSHOTS_DIR = path.join(__dirname, '../snapshots');
const VISION_MODEL = process.env.VISION_MODEL || 'siglip2-base-patch16-256';
const BATCH_SIZE = 10;
const MAX_DOCS = 0; // 0 for unlimited

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

/**
 * Hash an image buffer
 */
function hashBuffer(buffer) {
    return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Download image from URL
 */
async function downloadImage(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    return await res.buffer();
}

// Python server handles cropping now!

/**
 * Perform OCR using Gemini
 */
async function extractOCR(buffer, mimeType = 'image/jpeg') {
    try {
        const prompt = "Extract all text visible in this image. Return ONLY the text, separated by spaces. If no text, return empty string.";
        const result = await geminiModel.generateContent([
            prompt,
            { inlineData: { data: buffer.toString('base64'), mimeType } }
        ]);
        return result.response.text().trim();
    } catch (e) {
        console.warn(`[OCR] Gemini extraction failed: ${e.message}`);
        return "";
    }
}

/**
 * Generate vision embeddings via Local FastAPI Endpoint
 */
async function generateVisionEmbeddings(imageBuffer) {
    console.log(`[Embed] Requesting ${VISION_MODEL} embeddings from local API...`);

    const response = await fetch('http://127.0.0.1:8000/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            image_b64: imageBuffer.toString('base64')
        })
    });

    if (!response.ok) {
        throw new Error(`Embedding API failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Data returns float arrays for global, left, right
    const globalArr = new Float32Array(data.global);
    const leftArr = new Float32Array(data.left);
    const rightArr = new Float32Array(data.right);

    return {
        // Base64 Float32 is compact and efficient for MongoDB storage vs raw arrays
        globalBase64: Buffer.from(globalArr.buffer).toString('base64'),
        leftBase64: Buffer.from(leftArr.buffer).toString('base64'),
        rightBase64: Buffer.from(rightArr.buffer).toString('base64'),
        dim: data.dim
    };
}

async function processVideoDoc(db, doc) {
    console.log(`\nProcessing: ${doc.videoID} - ${doc.title}`);

    try {
        if (!doc.thumbnailurl) throw new Error("No thumbnailurl");

        // 1. Download & Hash
        const imageBuffer = await downloadImage(doc.thumbnailurl);
        const hash = hashBuffer(imageBuffer);

        // Optional: Skip if hash matches and OCR/Emb exists (for future delta runs)
        // if (doc.thumbHash === hash && doc.embStatus === 'done') return;

        // 2. Save Snapshot Local
        const filename = `${doc.videoID}.jpg`;
        const filepath = path.join(SNAPSHOTS_DIR, filename);
        await sharp(imageBuffer).jpeg().toFile(filepath);
        const snapshotUrl = `/snapshots/${filename}`;

        // 3. OCR
        console.log(`[${doc.videoID}] Running OCR...`);
        const ocrText = await extractOCR(imageBuffer);

        // 4. Vision Embeddings
        console.log(`[${doc.videoID}] Generating embeddings...`);
        const { globalBase64, leftBase64, rightBase64, dim } = await generateVisionEmbeddings(imageBuffer);

        // 6. Update MongoDB
        await db.collection('videos').updateOne(
            { _id: doc._id },
            {
                $set: {
                    thumbSnapshotUrl: snapshotUrl,
                    thumbHash: hash,
                    ocrText: ocrText,
                    emb: {
                        global: globalBase64,
                        left: leftBase64,
                        right: rightBase64,
                        model: VISION_MODEL,
                        dim: dim
                    },
                    embStatus: 'done',
                    embUpdatedAt: new Date()
                }
            }
        );

        console.log(`[${doc.videoID}] ✅ DONE`);

    } catch (err) {
        console.error(`[${doc.videoID}] ❌ FAILED: ${err.message}`);
        await db.collection('videos').updateOne(
            { _id: doc._id },
            { $set: { embStatus: 'failed', embUpdatedAt: new Date() } }
        );
    }
}

async function main() {
    // 0. Strict Preflight Check: If model is down, exit immediately
    await checkEmbeddingServerHealth();

    if (!fs.existsSync(SNAPSHOTS_DIR)) {
        fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    }

    try {
        const db = await connectDB();

        // Re-embed all docs with the old corrupted model (dim: 1 NaN vectors)
        const query = {
            $or: [
                { embStatus: { $ne: 'done' } },
                { 'emb.model': 'qwen3-vl-embedding' }
            ]
        };

        let cursor = db.collection('videos').find(query);
        if (MAX_DOCS > 0) cursor = cursor.limit(MAX_DOCS);

        const docs = await cursor.toArray();
        console.log(`\nFound ${docs.length} videos needing processing.`);

        // Process in batches
        for (let i = 0; i < docs.length; i += BATCH_SIZE) {
            const batch = docs.slice(i, i + BATCH_SIZE);
            console.log(`\n--- Batch ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(docs.length / BATCH_SIZE)} ---`);

            await Promise.all(batch.map(doc => processVideoDoc(db, doc)));

            // Artificial delay to prevent API rate limiting (Gemini / External Model)
            if (i + BATCH_SIZE < docs.length) {
                console.log(`Waiting 2 seconds before next batch...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        console.log(`\n🎉 Backfill Complete!`);
        process.exit(0);

    } catch (err) {
        console.error("FATAL ERROR:", err);
        process.exit(1);
    }
}

main();
