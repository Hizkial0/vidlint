const fs = require('fs');
const { analyzePipeline } = require('./pipeline_v2/orchestrator.js');
const path = require('path');

async function test() {
    const thumbPath = path.resolve('../test thumbnails/Hungry worm dark GTA v.jpg');
    if (!fs.existsSync(thumbPath)) {
        console.error("Test image not found:", thumbPath);
        return;
    }
    const imgBuffer = fs.readFileSync(thumbPath);
    const imgBase64 = 'data:image/jpeg;base64,' + imgBuffer.toString('base64');

    console.log('Starting timed test...');
    let lastTime = Date.now();

    const stateTracker = async (stage, payload) => {
        const now = Date.now();
        console.log(`[Timer] Stage ${stage} completed in ${(now - lastTime) / 1000} seconds. Details:`, payload.status, payload?.debug?.latencyMs ? `(${payload.debug.latencyMs}ms)` : '');
        lastTime = now;
    };

    try {
        await analyzePipeline(
            { title: '', text: [] },
            imgBase64,
            { title: 'Hungry worm dark GTA v', analyzeMode: 'deep', game: 'gta' },
            stateTracker
        );
        console.log('Done.');
    } catch (e) {
        console.error(e);
    }
}

test().catch(console.error);
