/**
 * Quick smoke test for the new pipeline.
 * Reads a local test thumbnail, uploads it via base64, and hits /analyze.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const TEST_IMAGE = path.join(__dirname, '..', 'test thumbnails', 'Hungry worm dark GTA v.jpg');
const SERVER_URL = 'http://localhost:8787';

async function main() {
    console.log('=== Pipeline Smoke Test ===');
    console.log(`Image: ${TEST_IMAGE}`);

    if (!fs.existsSync(TEST_IMAGE)) {
        console.error('Test image not found!');
        process.exit(1);
    }

    // Read image as base64 data URL
    const imgBuffer = fs.readFileSync(TEST_IMAGE);
    const b64 = imgBuffer.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${b64}`;

    console.log(`Image size: ${(imgBuffer.length / 1024).toFixed(1)} KB`);
    console.log(`Sending to ${SERVER_URL}/analyze ...`);
    console.log('Mode: deep | Game: gta');
    console.log('---');

    const _fetch = typeof fetch !== 'undefined' ? fetch : require('node-fetch');

    try {
        const res = await _fetch(`${SERVER_URL}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                imageUrlSmall: dataUrl,
                title: 'Hungry Worm Dark GTA V',
                context: 'GTA V gameplay thumbnail',
                game: 'gta',
                analyzeMode: 'deep'
            })
        });

        console.log(`HTTP Status: ${res.status}`);

        if (!res.ok) {
            const errText = await res.text();
            console.error('FAILED:', errText.substring(0, 500));
            process.exit(1);
        }

        const result = await res.json();

        // Validate output schema
        console.log('\n=== Output Validation ===');
        console.log(`Has rating?      ${!!result.rating ? 'YES' : 'MISSING'}`);
        console.log(`Has topProblems?  ${!!result.topProblems ? `YES (${result.topProblems.length})` : 'MISSING'}`);
        console.log(`Has fixes?        ${!!result.fixes ? `YES (${result.fixes.length})` : 'MISSING'}`);
        console.log(`Has layoutOptions? ${!!result.layoutOptions ? `YES (${result.layoutOptions.length})` : 'MISSING'}`);

        if (result.rating) {
            console.log(`\nRating total: ${result.rating.total}/100`);
            console.log(`Focus: ${JSON.stringify(result.rating.focus)}`);
        }

        if (result.fixes && result.fixes.length > 0) {
            console.log(`\nTop fix: "${result.fixes[0].title}"`);
        }

        if (result.layoutOptions && result.layoutOptions.length > 0) {
            console.log(`Layout A: "${result.layoutOptions[0].name}"`);
        }

        console.log('\n=== PIPELINE PASSED ===');
        console.log(JSON.stringify(result, null, 2).substring(0, 1500) + '...');

    } catch (err) {
        console.error('Request failed:', err.message);
        process.exit(1);
    }
}

main();
