
/**
 * Local Test Harness - Batch Runner
 * 
 * Usage: node tools/runBatch.js
 * 
 * - Runs 5 concurrent images against the local backend.
 * - Targets: POST http://localhost:8787/debug/full
 * - No fallbacks. Fail-fast.
 * - Logs results to console and summary.json
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const API_URL = 'http://localhost:8787/debug/full';
const CONCURRENCY = 5;

// Test Set: 5 Diverse Thumbnails (Mock or Real URLs)
// Test Set: 4 Local Thumbnails (Served via Backend)
const BASE_URL = 'http://localhost:8787/thumbnails';
const FILENAMES = [
    "180 Days Proving Science Shouldn’t Be in Charge Schedule 1.jpg",
    "Cadres Has 1,000,000 DIAMONDS in Minecraft!.jpg",
    "Hungry worm dark GTA v.jpg",
    "Top 10 Must-Have Mods for Schedule 1.jpg"
];

const TEST_IMAGES = FILENAMES.map(name => ({
    url: `${BASE_URL}/${encodeURIComponent(name)}`,
    title: name.replace(/\.jpg$/i, '')
}));

async function runTest(imageObj, index) {
    const { url: imageUrl, title } = imageObj;
    const runTag = `batch_${Date.now()}_img${index}`;
    console.log(`[${index}] Starting: ${title.substring(0, 40)}...`);

    try {
        const start = Date.now();
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                imageUrl,
                title,
                textPolicy: "text_allowed",
                tags: [runTag, "batch_local"]
            })
        });


        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error(`[${index}] ❌ JSON PARSE ERROR: ${e.message}`);
            console.error(`[${index}] RAW RESPONSE: ${text.substring(0, 500)}...`);
            return { status: 'crash', error: `JSON Parse: ${e.message}`, raw: text.substring(0, 200) };
        }

        const duration = Date.now() - start;

        if (data.ok) {
            console.log(`[${index}] ✅ SUCCESS (${duration}ms) RunID: ${data.runId}`);
            return { status: 'ok', runId: data.runId, duration, imageUrl, title };
        } else {
            console.error(`[${index}] ❌ FAILED (${duration}ms): ${data.error}`);
            return { status: 'error', error: data.error, duration, imageUrl, title };
        }

    } catch (err) {
        console.error(`[${index}] 💥 CRASH: ${err.message}`);
        return { status: 'crash', error: err.message, imageUrl, title };
    }
}

async function main() {
    console.log(`\n🚀 Starting Batch Run (Concurrency: ${CONCURRENCY})...\n`);

    // Slice to concurrency limit but we only have 4 now
    const queue = TEST_IMAGES.slice(0, CONCURRENCY);

    // Run all at once
    const promises = queue.map((img, i) => runTest(img, i));
    const results = await Promise.all(promises);

    // Summary
    const passed = results.filter(r => r.status === 'ok').length;
    const failed = results.filter(r => r.status !== 'ok').length;

    console.log(`\n=== BATCH COMPLETE ===`);
    console.log(`Total: ${results.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    fs.writeFileSync(
        path.join(__dirname, 'batch_summary.json'),
        JSON.stringify(results, null, 2)
    );
    console.log(`\nSaved summary to tools/batch_summary.json`);
}

main();
