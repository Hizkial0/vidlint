require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { analyzePipeline } = require('./pipeline_v2/orchestrator');

async function runLocalTest() {
    console.log("=== Local Isolated Pipeline Test ===");
    console.log("OPENAI_API_KEY inside script:", !!process.env.OPENAI_API_KEY);

    const testImg = path.join(__dirname, '..', 'test thumbnails', 'Hungry worm dark GTA v.jpg');
    if (!fs.existsSync(testImg)) {
        console.error("Test image not found!");
        return;
    }

    const imgBuf = fs.readFileSync(testImg);
    const b64 = imgBuf.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${b64}`;

    console.log("Image loaded.");

    try {
        const result = await analyzePipeline(
            { derivedMetrics: {}, anchors: {}, missing: [], faceData: {} },
            dataUrl,
            {
                title: 'Hungry worm dark GTA v',
                analyzeMode: 'fast',
                game: 'gta'
            },
            async (stage, data) => {
                console.log(`[Stage: ${stage}] Status: ${data.status}`);
            }
        );

        console.log("=== Pipeline Finished ===");
        console.log(JSON.stringify(result, null, 2).substring(0, 500));
    } catch (err) {
        console.error("Pipeline Error:", err);
    }
}

runLocalTest();
