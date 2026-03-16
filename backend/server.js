/**
 * Dashboard Linter Backend (Core Pipeline + Debug Harness)
 * 
 * Philosophy: FAIL FAST. Single Source of Truth.
 * 
 * - Serves /analyze (Production)
 * - Serves /debug/* (Local Test Harness)
 * - Connects to MongoDB for run logging
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Needs v2 for CommonJS

const { analyzePipeline, PipelineError } = require('./pipeline_v2/orchestrator');

// Utilities
const { connectDB, createRun, logStage, completeRun, failRun, getRun, listRuns } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ANALYZER_URL = process.env.ANALYZER_URL || 'http://localhost:8001';

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve landing page + static assets from project root with NO aggressive caching
app.use(express.static(path.join(__dirname, '..'), {
    setHeaders: (res, path) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }
}));

// Serve Local Test Thumbnails
app.use('/thumbnails', express.static(path.join(__dirname, '../test thumbnails')));

// Serve Local Snapshots (Winner Library)
app.use('/snapshots', express.static(path.join(__dirname, 'snapshots')));

// Initialize DB and Embedded Vector Search on Startup
connectDB().then(async () => {
    try {
        const { initWinnerLibrary } = require('./pipeline_v2/winnerRetriever');
        await initWinnerLibrary();
    } catch (e) {
        console.error("Warning: Failed to initialize Winner Library:", e);
    }
}).catch(err => {
    console.error("FATAL: Could not connect to MongoDB. Debug logs will fail.");
    console.error(err);
});

// Health Check
app.get('/health', (req, res) => res.json({ status: 'ok', pipeline: 'core-only', analyzer: ANALYZER_URL }));

// Helper: Convert local URLs to Base64 for OpenAI/Analyzer
async function resolveImage(url) {
    // Only process localhost URLs
    if (url && (url.includes('localhost') || url.includes('127.0.0.1'))) {
        try {
            console.log(`[Proxy] Fetching local image: ${url}`);
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`Status ${resp.status}`);
            const buf = await resp.buffer();
            const b64 = buf.toString('base64');
            const mime = resp.headers.get('content-type') || 'image/jpeg';
            return `data:${mime};base64,${b64}`;
        } catch (e) {
            console.error(`[Proxy] Failed to resolve local image: ${e.message}`);
            return url; // Fallback to original
        }
    }
    return url;
}

/**
 * Unified Pipeline Executor (Persisted)
 * Handles DB lifecycle: Running -> Stages -> OK/Failed
 */
async function executePipelineAndPersist({ imageUrl, mode, context, source, title, textPolicy, stageMode = 'full', analyzeMode = 'normal', game = '', tags = [] }) {
    // 1. Normalize Context found (String vs Object)
    let contextObj = {};
    let contextStr = '';

    if (typeof context === 'string') {
        contextStr = context;
        contextObj = { text: context };
    } else if (typeof context === 'object' && context !== null) {
        contextObj = context;
        contextStr = context.text || JSON.stringify(context);
    }

    // Ensure title is preserved in DB context
    if (title) contextObj.title = title;

    // 2. Create Run in DB
    const runId = await createRun({
        imageUrl,
        mode,
        source,
        context: contextObj, // Store structured data
        tags,
        promptVersions: { pipeline: 'v2-lite' }
    });
    console.log(`[Executor] Started Run ${runId} (${mode}/${stageMode})`);

    try {
        // ... (inputs preparation) ...
        const processedImageUrl = await resolveImage(imageUrl);

        // ... (CV stage) ...
        const cvStart = Date.now();
        let cvRes;
        // MOCK CV FOR TESTING
        if (process.env.MOCK_CV === 'true') {
            console.log("[server] Using MOCK CV signals");
            cvRes = {
                ok: true,
                json: async () => ({
                    regions: [],
                    anchors: { hero_1: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } },
                    missing: ['hook_1', 'stealer_1'],
                    derivedMetrics: { hero_area_ratio: 0.25 },
                    signals: { mobile: { passed: true }, ocr: { wordCount: 5 } },
                    faceData: { exists: true, count: 1 }
                })
            };
        } else {
            try {
                cvRes = await fetch(`${ANALYZER_URL}/analyze_signals`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        imageUrlSmall: processedImageUrl
                    })
                });
                if (!cvRes.ok) throw new Error(`Analyzer Error ${cvRes.status}`);
            } catch (e) {
                console.warn(`[CV] Analyzer unreachable (${e.message}). Falling back to MOCK CV.`);
                cvRes = {
                    ok: true,
                    json: async () => ({
                        regions: [],
                        anchors: { hero_1: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } },
                        missing: ['hook_1', 'stealer_1'],
                        derivedMetrics: { hero_area_ratio: 0.25 },
                        signals: { mobile: { passed: true }, ocr: { wordCount: 5 } },
                        faceData: { exists: true, count: 1 }
                    })
                };
            }
        }

        const cvData = await cvRes.json();
        const cv = {
            regions: cvData.regions || [],
            anchors: cvData.anchors || {},
            missing: cvData.missing || [],
            quality: cvData.quality || {},
            derivedMetrics: cvData.derivedMetrics || {},
            signals: cvData.signals || {},
            faceData: cvData.faceData
        };

        await logStage(runId, 'cv', {
            status: 'ok',
            result: cv,
            debug: { latencyMs: Date.now() - cvStart }
        });

        if (stageMode === 'cv') {
            await completeRun(runId, { cv });
            return { runId, status: 'ok', result: { cv } };
        }

        // 4. Run Pipeline (Orchestrator)
        // Pass STRING context to pipeline for prompts
        const output = await analyzePipeline(cv, processedImageUrl, {
            textPolicy,
            title,
            context: contextStr, // Pass string for prompts
            stageMode,
            analyzeMode,
            game
        }, async (stage, data) => {
            await logStage(runId, stage, data);
        });

        // 5. Complete Run
        console.log(`[Executor] Run ${runId} completed OK — persisting to DB...`);
        await completeRun(runId, output);
        console.log(`[Executor] Run ${runId} persisted as OK.`);
        return { runId, status: 'ok', result: output };

    } catch (err) {
        console.error(`[Executor] Run ${runId} FAILED: ${err.message}`);
        console.error(`[Executor] Error stage: ${err.stage || 'unknown'}`);
        await failRun(runId, err);
        console.log(`[Executor] Run ${runId} persisted as FAILED.`);
        throw Object.assign(err, { runId });
    }
}

/**
 * PRODUCTION ENDPOINT: /analyze
 */
app.post('/analyze', async (req, res, next) => {
    try {
        console.log("[/analyze] Received Payload keys:", Object.keys(req.body));
        const { imageUrlSmall, title, context, textPolicy, analyzeMode, game } = req.body;
        console.log(`[/analyze] imageUrlSmall Length: ${imageUrlSmall ? imageUrlSmall.length : 'MISSING/EMPTY'}`);

        if (!imageUrlSmall) throw new PipelineError('cv', 'Missing imageUrlSmall');

        const { runId, result } = await executePipelineAndPersist({
            imageUrl: imageUrlSmall,
            mode: 'production',
            source: 'ui',
            title,
            context,
            textPolicy,
            analyzeMode: analyzeMode || 'high',
            game: game || '',
            tags: ['prod_analyze']
        });

        res.json({
            ...result,
            _meta: { pipeline: 'core', ver: '2.0.0', runId }
        });

    } catch (err) {
        // Error already logged to DB by executor
        next(err);
    }
});

// ==========================================
// FIX GENERATOR ENDPOINTS (Image Editing Loop)
// ==========================================

const { OpenAI } = require('openai');
let _serverOpenai;
function getServerOpenAI() {
    if (!_serverOpenai) _serverOpenai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return _serverOpenai;
}

// 1. Generate Prompt (ChatGPT)
app.post('/generate-prompt', async (req, res, next) => {
    try {
        const { fix, game, baseImage, referenceImages, sceneSummary, styleRead } = req.body;
        console.log("[FixGenerator] /generate-prompt START", { fix: fix?.title, game });
        if (!fix) throw new Error("Missing selected fix");
        if (!baseImage) throw new Error("Missing baseImage");

        const developerPrompt = `You are a gaming thumbnail artist and edit-prompt writer for nano banana.

Look at the current gaming thumbnail, the main given problem, and the references.
Be creative and smart enough to solve the problem in convinet way as a gaming thumbnail artist.
look at the thumbnail and give the approprate fix for it to increate ctr without changing the current sytle.

Write direct visual instructions only.
Be literal, clear, and specific.

Rules:
- edit the current thumbnail only
- say what to keep
- say what to change
- say what to remove if needed but it should not change the current sytle.
- say what must stay visible
- avoid abstract thumbnail strategy words
- avoid stylistic theory
- keep it clean 
- tell the fixes cleanily in detail to not confuse the ai so it will only create what you said cleanly 
- the more simpler and bigger effect and cleaner the prompt the better the ai will understand and generate the image
- Be smart and creative as a super proffesional thumbnail artist who tells for a baby how to do it 
        `.trim();

        const compactPayload = {
            game: game || "Unknown Gaming",
            sceneSummary: sceneSummary || {},
            styleRead: styleRead || {},
            selectedFix: {
                title: fix.title || "",
                why: fix.why || "",
                instruction: fix.instruction || "",
                applyTo: fix.applyTo || [],
                lever: fix.lever || "",
                evidence: fix.evidence || "",
                goal: fix.goal || "",
                moves: fix.moves || []
            }
        };

        const baseResolved = await resolveImage(baseImage);
        console.log(`[FixGenerator] baseImage type: ${baseResolved?.substring(0, 30)}... (len=${baseResolved?.length})`);

        const userContent = [
            {
                type: "text",
                text: JSON.stringify(compactPayload)
            },
            {
                type: "image_url",
                image_url: { url: baseResolved, detail: "high" }
            }
        ];

        if (Array.isArray(referenceImages) && referenceImages.length) {
            console.log(`[FixGenerator] ${referenceImages.length} reference images`);
            const refsResolved = await Promise.all(referenceImages.map(img => resolveImage(img)));
            refsResolved.forEach((url) => {
                userContent.push({
                    type: "image_url",
                    image_url: { url, detail: "low" }
                });
            });
        }

        console.log(`[FixGenerator] Calling OpenAI with ${userContent.length} content blocks...`);
        const response = await getServerOpenAI().chat.completions.create({
            model: "gpt-5-mini-2025-08-07",
            messages: [
                {
                    role: "developer",
                    content: developerPrompt
                },
                {
                    role: "user",
                    content: userContent
                }
            ],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "thumbnail_edit_prompt",
                    strict: true,
                    schema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["prompt", "negativePrompt"],
                        properties: {
                            prompt: { type: "string" },
                            negativePrompt: { type: "string" }
                        }
                    }
                }
            },
            max_completion_tokens: 2000
        });

        const finishReason = response.choices?.[0]?.finish_reason;
        const usage = response.usage;
        console.log(`[FixGenerator] finish_reason: ${finishReason}, tokens: ${JSON.stringify(usage)}`);
        console.log(`[FixGenerator] Full choice[0]:`, JSON.stringify(response.choices?.[0]));

        let content = response.choices?.[0]?.message?.content || "{}";
        const refusal = response.choices?.[0]?.message?.refusal;

        if (refusal) {
            console.warn("[FixGenerator] Model Refusal:", refusal);
            throw new Error(`Model Refusal: ${refusal}`);
        }

        console.log(`[FixGenerator] RAW Content (Raw): ${content}`);

        // Strip markdown blocks if present
        if (content.startsWith('```json')) {
            content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (content.startsWith('```')) {
            content = content.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        console.log(`[FixGenerator] RAW Content (Stripped): ${content}`);
        const result = JSON.parse(content);
        console.log(`[FixGenerator] Parsed Result:`, result);
        console.log(`[FixGenerator] Generated Prompt: ${result.prompt}`);

        res.json({
            ok: true,
            prompt: result.prompt,
            negativePrompt: result.negativePrompt
        });
    } catch (e) {
        console.error("[FixGenerator] Prompt generation failed:", e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// 2. Generate Image (Gemini image editing)
app.post('/generate-image', async (req, res, next) => {
    try {
        const { baseImage, prompt, negativePrompt, strength, referenceImage } = req.body;
        if (!baseImage || !prompt) throw new Error("Missing baseImage or prompt");

        console.log(`[FixGenerator] Triggering Image Edit via Gemini...`);
        console.log(`Prompt: ${prompt} | Strength: ${strength}`);

        const { GoogleGenAI } = require('@google/genai');
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        // Extract base64 image data
        let imageBase64, mimeType;
        if (baseImage.startsWith('data:')) {
            const match = baseImage.match(/^data:(image\/\w+);base64,(.+)$/);
            if (match) {
                mimeType = match[1];
                imageBase64 = match[2];
            }
        }

        if (!imageBase64) {
            // Try fetching the URL
            const imgFetch = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
            const imgRes = await imgFetch(baseImage);
            if (!imgRes.ok) throw new Error(`Failed to fetch base image: ${imgRes.status}`);
            const imgBuf = await imgRes.buffer();
            imageBase64 = imgBuf.toString('base64');
            mimeType = 'image/jpeg';
        }

        // Build strength instruction
        const strengthMap = { low: 'subtle', medium: 'moderate', high: 'strong' };
        const strengthWord = strengthMap[strength] || 'moderate';

        const editPrompt = `Edit this thumbnail image with a ${strengthWord} change: ${prompt}${negativePrompt ? `\nAvoid: ${negativePrompt}` : ''}`;

        // Build image parts
        const imageParts = [
            { text: editPrompt },
            { inlineData: { mimeType, data: imageBase64 } }
        ];

        // Add reference image if provided
        if (referenceImage) {
            const refMatch = referenceImage.match(/^data:(image\/\w+);base64,(.+)$/);
            if (refMatch) {
                imageParts.push({ inlineData: { mimeType: refMatch[1], data: refMatch[2] } });
                console.log(`[FixGenerator] Including reference image in request`);
            }
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: [
                {
                    role: 'user',
                    parts: imageParts
                }
            ],
            config: {
                responseModalities: ['IMAGE', 'TEXT']
            }
        });

        // Extract image from response
        let resultImageUrl = baseImage; // fallback
        if (response.candidates && response.candidates[0]) {
            const parts = response.candidates[0].content?.parts || [];
            for (const part of parts) {
                if (part.inlineData && part.inlineData.data) {
                    const outMime = part.inlineData.mimeType || 'image/png';
                    resultImageUrl = `data:${outMime};base64,${part.inlineData.data}`;
                    console.log(`[FixGenerator] Got generated image (${outMime})`);
                    break;
                }
            }
        }

        res.json({ ok: true, imageUrl: resultImageUrl, generatedAt: Date.now() });

    } catch (e) {
        console.error("[FixGenerator] Image generation failed:", e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * DEBUG ENDPOINTS (Local Harness)
 */

// Removed obsolete debug endpoints

// POST /debug/full (Full Pipeline)
app.post('/debug/full', async (req, res, next) => {
    try {
        const { imageUrl, title, context, textPolicy, tags, retrievalMode } = req.body;

        const { runId, result } = await executePipelineAndPersist({
            imageUrl,
            mode: 'debug-full',
            source: 'harness',
            title,
            context,
            textPolicy,
            retrievalMode,
            tags
        });

        res.json({ ok: true, runId, result });
    } catch (e) {
        // Executor already logged failure
        next(e);
    }
});

// POST /debug/stage (Partial Pipeline)
app.post('/debug/stage', async (req, res, next) => {
    try {
        const { imageUrl, stageMode, title, context, textPolicy } = req.body;

        const { runId, result } = await executePipelineAndPersist({
            imageUrl,
            mode: `debug-${stageMode}`,
            source: 'harness',
            stageMode, // 'cheap' | 'weakness' | 'final'
            title,
            context,
            textPolicy
        });

        res.json({ ok: true, runId, result });
    } catch (e) {
        next(e);
    }
});


// POST /debug/batch (Concurrency Limit via user tool, or simple loop here)
// Implementation: The user tool runBatch.js will handle concurrency against /debug/full 
// But if we want the server to handle it:
app.post('/debug/batch', async (req, res) => {
    // Current design: Client handles batching calls to /debug/full
    // We'll just echo back "Use tools/runBatch.js"
    res.json({ msg: "Use tools/runBatch.js to trigger concurrent calls to /debug/full" });
});

app.get('/debug/runs', async (req, res) => {
    const runs = await listRuns(50);
    res.json(runs);
});

app.get('/debug/run/:id', async (req, res) => {
    const run = await getRun(req.params.id);
    res.json(run);
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(`[SERVER ERROR] ${err.message}`);
    if (err instanceof PipelineError) {
        return res.status(422).json({
            ok: false,
            status: 422,
            code: err.code || err.stage || 'pipeline_error',
            stage: err.stage || err.code || 'pipeline_error',
            message: err.message
        });
    }
    res.status(500).json({ ok: false, status: 500, message: 'Internal Server Error', error: err.message });
});

app.listen(PORT, () => {
    console.log(`\n🚀 Backend (Core + Debug) running on ${PORT}`);
    console.log(`Target: ${ANALYZER_URL}`);
    console.log(`DB: ${process.env.MONGO_URI}/${process.env.DB_NAME}`);
});
