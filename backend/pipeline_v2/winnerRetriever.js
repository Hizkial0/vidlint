/**
 * Stage: Winner Retriever (Reranked)
 *
 * Flow:
 *   1. Generate image embeddings via local SigLIP API
 *   2. 3-vector LanceDB search (global, left, right) → top 20
 *   3. Rerank with formula:
 *      finalScore = 0.55*similarity + 0.20*outlierNorm + 0.15*queryMatch + 0.10*freshness
 *   4. Dedupe, max 1 per channel in top 3, return top 3
 */

const { connectDB } = require('../db');
const lancedb = require('@lancedb/lancedb');

let db;
let winnerTable;
let isInitialized = false;

// ─── Embedding API ───────────────────────────────────────────

async function generateVisionEmbeddings(imageBuffer) {
    console.log(`[WinnerRetriever] Requesting embeddings from local API...`);
    const _fetch = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
    const response = await _fetch('http://127.0.0.1:8000/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_b64: imageBuffer.toString('base64') })
    });

    if (!response.ok) {
        throw new Error(`Embedding API failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const dim = data.dim || data.global.length;

    console.log(`[WinnerRetriever] Embedding dim: ${dim} | global len: ${data.global.length}`);

    // Cast to Float32 for LanceDB type compatibility (JS numbers are Float64)
    const toF32 = (arr) => Array.from(new Float32Array(arr));

    return {
        global: toF32(data.global),
        left: toF32(data.left),
        right: toF32(data.right),
        dim
    };
}

// ─── Init: Load from Mongo into LanceDB ──────────────────────

async function initWinnerLibrary() {
    if (isInitialized) return;
    console.log('[WinnerLibrary] Initializing embedded vector database...');

    try {
        const mongoDb = await connectDB();

        const winners = await mongoDb.collection('videos').find({
            embStatus: 'done',
            outlierScore: { $gte: 3.5 },
            views: { $gte: 200000 }
        }).project({
            videoID: 1, title: 1, channel: 1, views: 1,
            outlierScore: 1, thumbSnapshotUrl: 1, ocrText: 1, emb: 1,
            publishedAt: 1, tags: 1
        }).toArray();

        console.log(`[WinnerLibrary] Found ${winners.length} winner documents.`);

        if (winners.length === 0) {
            console.warn('[WinnerLibrary] No winners found. System will retrieve 0 references.');
            isInitialized = true;
            return;
        }

        let skipped = 0;
        const lanceData = [];
        for (const doc of winners) {
            try {
                const globalArr = Array.from(new Float32Array(Buffer.from(doc.emb.global, 'base64').buffer));
                const leftArr = Array.from(new Float32Array(Buffer.from(doc.emb.left, 'base64').buffer));
                const rightArr = Array.from(new Float32Array(Buffer.from(doc.emb.right, 'base64').buffer));

                // Skip corrupted vectors (NaN or wrong dimension)
                if (globalArr.length < 2 || globalArr.some(isNaN)) {
                    skipped++;
                    continue;
                }

                lanceData.push({
                    id: doc.videoID,
                    title: doc.title,
                    channel: doc.channel,
                    views: doc.views,
                    outlierScore: doc.outlierScore,
                    thumbSnapshotUrl: doc.thumbSnapshotUrl,
                    ocrText: doc.ocrText || '',
                    publishedAt: doc.publishedAt ? String(doc.publishedAt) : '',
                    tags: (doc.tags || []).join(' '),
                    vector_global: globalArr,
                    vector_left: leftArr,
                    vector_right: rightArr
                });
            } catch (e) {
                skipped++;
            }
        }

        if (skipped > 0) {
            console.warn(`[WinnerLibrary] Skipped ${skipped}/${winners.length} docs with corrupted/NaN embeddings.`);
        }

        if (lanceData.length === 0) {
            console.warn('[WinnerLibrary] All vectors corrupted. Run backfill: node backend/tools/buildWinnerLibrary.js');
            isInitialized = true;
            return;
        }

        db = await lancedb.connect('memory://');
        winnerTable = await db.createTable('winners', lanceData, { mode: 'overwrite' });

        isInitialized = true;
        console.log(`[WinnerLibrary] Ready with ${lanceData.length} records.`);

    } catch (err) {
        console.error('[WinnerLibrary] Failed to initialize:', err);
        throw err;
    }
}

// ─── Scoring Helpers ─────────────────────────────────────────

/** Convert L2 distance to 0-1 similarity. Clamped. */
function distanceToSimilarity(distance) {
    // LanceDB returns L2 distance. For normalized vectors, d² = 2(1-cos).
    // Approximate: similarity ≈ 1 - distance (works for small distances)
    return Math.max(0, Math.min(1, 1 - distance));
}

/** Normalize outlier score (assumed 0-10 range) to 0-1 */
function normalizeOutlier(outlierScore) {
    return Math.max(0, Math.min(1, (outlierScore || 0) / 10));
}

/** Keyword overlap between router output and candidate doc */
function calcQueryMatchScore(routerOutput, candidateTitle, candidateTags) {
    if (!routerOutput) return 0;

    const intent = routerOutput.retrievalIntent || {};
    const searchQuery = (intent.searchQuery || '').toLowerCase();
    const preferList = (intent.prefer || []).map(p => p.toLowerCase());

    // Tokenize router keywords
    const routerTokens = new Set(
        (searchQuery.match(/\w+/g) || []).filter(w => w.length > 2)
    );
    if (routerTokens.size === 0) return 0;

    // Tokenize candidate
    const docTokens = new Set([
        ...((candidateTitle || '').toLowerCase().match(/\w+/g) || []),
        ...((candidateTags || '').toLowerCase().match(/\w+/g) || [])
    ]);

    // Keyword overlap
    let overlapCount = 0;
    for (const token of routerTokens) {
        if (docTokens.has(token)) overlapCount++;
    }
    const keywordOverlap = overlapCount / routerTokens.size;

    // Prefer-tag overlap (bonus)
    let preferOverlap = 0;
    if (preferList.length > 0) {
        const docText = `${candidateTitle} ${candidateTags}`.toLowerCase();
        let preferHits = 0;
        for (const pref of preferList) {
            const prefWords = pref.match(/\w+/g) || [];
            const matches = prefWords.filter(w => docText.includes(w));
            if (matches.length >= Math.ceil(prefWords.length / 2)) preferHits++;
        }
        preferOverlap = preferHits / preferList.length;
    }

    // Combined: 70% keyword + 30% prefer
    return Math.max(0, Math.min(1, 0.7 * keywordOverlap + 0.3 * preferOverlap));
}

/** Freshness score based on published date */
function calcFreshnessScore(publishedAt) {
    if (!publishedAt) return 0.5; // Default if missing

    const now = Date.now();
    const pubDate = new Date(publishedAt).getTime();
    if (isNaN(pubDate)) return 0.5;

    const daysOld = (now - pubDate) / (1000 * 60 * 60 * 24);

    if (daysOld <= 30) return 1.0;
    if (daysOld <= 90) return 0.8;
    if (daysOld <= 180) return 0.6;
    if (daysOld <= 365) return 0.4;
    return 0.2;
}

// ─── Main Retrieval + Rerank ─────────────────────────────────

async function retrieveWinners(imageBuffer, { title = '', context = '', analyzeMode = 'normal', routerOutput = null } = {}) {
    if (!isInitialized) {
        console.warn('[WinnerRetriever] Library not initialized. Attempting late init.');
        await initWinnerLibrary();
    }

    if (!winnerTable) {
        if (analyzeMode === 'fast') {
            console.log('[WinnerRetriever] No winner table. Skipping (fast mode).');
            return [];
        }

        console.warn('[WinnerRetriever] No winner table. Falling back to YouTube...');
        try {
            const { runYouTubeRetriever } = require('./youtubeRetriever');
            const ytQuery = title ? `${context} ${title}`.trim() : 'gaming';
            const ytRes = await runYouTubeRetriever({
                query_variants: [ytQuery, `${ytQuery} thumbnail`]
            });
            return (ytRes.result?.candidates || []).slice(0, 5).map(r => ({
                videoId: r.videoId,
                title: r.title,
                channelId: r.channelId,
                viewCount: r.viewCount,
                outlierScore: r.outlierScore || 1.0,
                thumbnailUrl: r.thumbnailUrl || r.snippetThumb,
                matchDistance: 0,
                reason: 'YouTube fallback'
            }));
        } catch (fbErr) {
            console.error(`[WinnerRetriever] YouTube fallback failed: ${fbErr.message}`);
            return [];
        }
    }

    try {
        const start = Date.now();
        console.log(`[WinnerRetriever] Running retrieval + rerank...`);

        // ── Step 1: Get embeddings ──
        const queryEmbs = await generateVisionEmbeddings(imageBuffer);

        // ── Step 2: 3-vector LanceDB search → top 100 each ──
        const [resGlobal, resLeft, resRight] = await Promise.all([
            winnerTable.vectorSearch(Array.from(new Float32Array(queryEmbs.global))).column('vector_global').limit(100).toArray(),
            winnerTable.vectorSearch(Array.from(new Float32Array(queryEmbs.left))).column('vector_left').limit(100).toArray(),
            winnerTable.vectorSearch(Array.from(new Float32Array(queryEmbs.right))).column('vector_right').limit(100).toArray()
        ]);

        // ── Step 3: Score fusion (min distance = best match) ──
        const scoreMap = new Map();
        const processResults = (results) => {
            results.forEach(r => {
                const existing = scoreMap.get(r.id) || { doc: r, distances: [] };
                existing.distances.push(r._distance);
                scoreMap.set(r.id, existing);
            });
        };
        processResults(resGlobal);
        processResults(resLeft);
        processResults(resRight);

        console.log(`[WinnerRetriever] LanceDB raw matches (pre-filter): ${scoreMap.size}`);

        // ── Step 4: Take top 20 by raw similarity ──
        let candidates = Array.from(scoreMap.values()).map(entry => {
            const minDistance = Math.min(...entry.distances);
            return { ...entry.doc, rawDistance: minDistance };
        });
        candidates.sort((a, b) => a.rawDistance - b.rawDistance);
        candidates = candidates.slice(0, 20);

        console.log(`[WinnerRetriever] Candidates after Top-20 slice: ${candidates.length}`);

        // ── Step 5: Rerank with the 4-factor formula ──
        const reranked = candidates.map(c => {
            const similarity = distanceToSimilarity(c.rawDistance);
            const outlierNorm = normalizeOutlier(c.outlierScore);
            const queryMatch = calcQueryMatchScore(routerOutput, c.title, c.tags);
            const freshness = calcFreshnessScore(c.publishedAt);

            const finalScore =
                0.55 * similarity +
                0.20 * outlierNorm +
                0.15 * queryMatch +
                0.10 * freshness;

            return {
                videoId: c.id,
                title: c.title,
                channelId: c.channel,
                viewCount: c.views,
                outlierScore: c.outlierScore,
                thumbnailUrl: c.thumbSnapshotUrl,
                matchDistance: c.rawDistance,
                finalScore,
                _scores: { similarity, outlierNorm, queryMatch, freshness },
                reason: `Score: ${finalScore.toFixed(3)} (sim=${similarity.toFixed(2)} out=${outlierNorm.toFixed(2)} qm=${queryMatch.toFixed(2)} fresh=${freshness.toFixed(2)})`
            };
        });

        // ── Step 6: Sort by finalScore descending ──
        reranked.sort((a, b) => b.finalScore - a.finalScore);

        // ── Step 7: Dedupe + max 1 per channel in top 3 ──
        const seen = new Set();
        const channelUsed = new Set();
        const top3 = [];

        for (const ref of reranked) {
            if (top3.length >= 3) break;
            if (seen.has(ref.videoId)) continue;
            if (channelUsed.has(ref.channelId)) continue;

            seen.add(ref.videoId);
            channelUsed.add(ref.channelId);
            top3.push(ref);
        }

        const elapsed = Date.now() - start;
        console.log(`[WinnerRetriever] Done in ${elapsed}ms. ${top3.length} refs returned (from ${candidates.length} candidates).`);
        if (top3.length > 0) {
            console.log(`[WinnerRetriever] Top ref: "${top3[0].title}" (score=${top3[0].finalScore.toFixed(3)})`);
        }

        return top3;

    } catch (err) {
        console.error('[WinnerRetriever] CRITICAL FAIL:', err);
        throw err;
    }
}

module.exports = { initWinnerLibrary, retrieveWinners };
