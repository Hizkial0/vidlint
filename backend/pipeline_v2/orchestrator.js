/**
 * Core Pipeline: Orchestrator
 *
 * New Flow: Understand → Retrieve → Judge
 *
 *   1. Router (Gemini Flash) — understand the thumbnail
 *   2. Winner Retriever — targeted local refs, reranked by router
 *   3. YouTube Retriever (Deep mode only) — live examples
 *   4. Final RAG Builder — tiny context packer
 *   5. Final Decider (GPT-5.2) — single critique call
 *   6. Normalize — validate output
 *
 * Modes:
 * - Fast:   Router + Winners (top 3),           gpt-5-mini
 * - Normal: Router + Winners (top 3),           gpt-5.2
 * - Deep:   Router + Winners (top 3) + YT (2),  gpt-5.2
 */

const { runRouter } = require('./router');
const { runFinalSynth } = require('./finalSynth');
const { normalizeOutput } = require('./normalize');
const { runYouTubeRetriever } = require('./youtubeRetriever');
const { buildFinalRag } = require('./finalRagBuilder');

class PipelineError extends Error {
    constructor(stage, message, details = {}) {
        super(message);
        this.name = 'PipelineError';
        this.stage = stage;
        this.details = details;
    }
}

async function analyzePipeline(cv, imageUrl, options = {}, onStage = null) {
    const {
        title = '',
        context = '',
        stageMode = 'full',
        analyzeMode = 'high', // fast | deep | high
        game = ''
    } = options;

    console.log(`[Orchestrator] Starting analysis: "${title}" (Mode: ${analyzeMode}, Game: ${game})`);

    try {
        // ============================================================
        // 1. ROUTER — Understand the thumbnail first (Gemini Flash)
        // ============================================================
        let routerOutput;
        try {
            const routerRes = await runRouter(imageUrl, title, game);
            routerOutput = routerRes.result;
            if (onStage) await onStage('router', { status: 'ok', result: routerOutput, debug: routerRes._debug });
            console.log(`[Orchestrator] Router done. Confidence: ${routerOutput.confidence}`);
        } catch (err) {
            console.warn(`[Orchestrator] Router failed (soft): ${err.message}. Using defaults.`);
            routerOutput = {
                retrievalIntent: { searchQuery: `${game} ${title}`.trim() || 'gaming', prefer: [], avoid: [] },
                interpretationHints: { likelyThesis: '', likelyJudgmentFrame: '', possibleHiddenContext: '' },
                confidence: 0.0
            };
            if (onStage) await onStage('router', { status: 'warn', result: routerOutput, error: err.message });
        }

        // ============================================================
        // 2. WINNER RETRIEVER — Targeted local refs, reranked by router
        // ============================================================
        let winnerRefs = [];
        if (imageUrl) {
            try {
                let imageBuffer;
                if (imageUrl.startsWith('data:image')) {
                    const b64 = imageUrl.split(',')[1];
                    imageBuffer = Buffer.from(b64, 'base64');
                } else {
                    const fetch = require('node-fetch');
                    const res = await fetch(imageUrl);
                    if (!res.ok) throw new Error(`HTTP ${res.status} fetching image`);
                    imageBuffer = await res.buffer();
                }

                const { retrieveWinners } = require('./winnerRetriever');
                winnerRefs = await retrieveWinners(imageBuffer, { title, context, analyzeMode, routerOutput });
                if (onStage) await onStage('winner_retrieve', { status: 'ok', result: winnerRefs });
                console.log(`[Orchestrator] Winners: ${winnerRefs.length} refs returned`);

            } catch (err) {
                // Soft fail — continue without winners
                console.warn(`[Orchestrator] Winner Retrieval failed (soft): ${err.message}`);
                winnerRefs = [];
                if (onStage) await onStage('winner_retrieve', { status: 'warn', result: [], error: err.message });
            }
        }

        // ============================================================
        // 3. YOUTUBE RETRIEVER — Deep mode only
        // ============================================================
        let ytRefs = [];
        if (analyzeMode === 'deep') {
            try {
                const queryStr = routerOutput.retrievalIntent?.searchQuery || `${game} ${title}`.trim() || 'gaming';
                const queryPack = {
                    query_variants: [queryStr, `${queryStr} thumbnail`],
                    negative_queries: routerOutput.retrievalIntent?.avoid || []
                };

                const ytRes = await runYouTubeRetriever(queryPack);
                const candidates = ytRes.result?.candidates || [];

                // ── YouTube Rerank Formula ──
                // youtubeScore = 0.45*titleMatch + 0.30*recency + 0.25*performance
                const routerTokens = new Set(
                    (queryStr.toLowerCase().match(/\w+/g) || []).filter(w => w.length > 2)
                );

                const scored = candidates.map(c => {
                    // titleMatch: keyword overlap
                    const docTokens = new Set(
                        ((c.title || '').toLowerCase().match(/\w+/g) || [])
                    );
                    let overlap = 0;
                    for (const t of routerTokens) { if (docTokens.has(t)) overlap++; }
                    const titleMatch = routerTokens.size > 0 ? Math.min(1, overlap / routerTokens.size) : 0;

                    // recency: freshness bucket
                    let recency = 0.5;
                    if (c.publishedAt) {
                        const daysOld = (Date.now() - new Date(c.publishedAt).getTime()) / (1000 * 60 * 60 * 24);
                        if (daysOld <= 30) recency = 1.0;
                        else if (daysOld <= 90) recency = 0.8;
                        else if (daysOld <= 180) recency = 0.6;
                        else if (daysOld <= 365) recency = 0.4;
                        else recency = 0.2;
                    }

                    // performance: log10(views+1)/7, clamped 0-1
                    const views = c.viewCount || 0;
                    const performance = Math.min(1, Math.log10(views + 1) / 7);

                    const score = 0.45 * titleMatch + 0.30 * recency + 0.25 * performance;
                    return { ...c, _ytScore: score };
                });

                scored.sort((a, b) => b._ytScore - a._ytScore);

                // Keep top 2
                ytRefs = scored.slice(0, 2).map(c => ({
                    title: c.title,
                    thumbnailUrl: c.thumbnailUrl || c.snippetThumb || '',
                    channel: c.channelId || '',
                    views: c.viewCount || 0,
                    reason: `YT score: ${c._ytScore.toFixed(3)}`
                }));

                if (onStage) await onStage('youtube_retrieve', { status: 'ok', result: ytRefs, debug: ytRes._debug });
                console.log(`[Orchestrator] YouTube: ${ytRefs.length} refs returned`);
            } catch (e) {
                console.warn(`[Orchestrator] YouTube retrieval failed (soft): ${e.message}`);
                ytRefs = [];
                if (onStage) await onStage('youtube_retrieve', { status: 'warn', result: [], error: e.message });
            }
        } else {
            console.log(`[Orchestrator] YouTube skipped (mode=${analyzeMode})`);
        }

        // ============================================================
        // 4. FINAL RAG BUILDER — Tiny context packer
        // ============================================================
        let ragPack;
        try {
            const ragRes = buildFinalRag(routerOutput, winnerRefs, ytRefs);
            ragPack = ragRes.result;
            if (onStage) await onStage('final_rag', { status: 'ok', result: ragPack, debug: ragRes._debug });
        } catch (e) {
            throw new PipelineError('final_rag', `RAG build failed: ${e.message}`, { error: e.toString() });
        }

        // ============================================================
        // 5. FINAL DECIDER — Single LLM call (same output schema)
        // ============================================================
        let finalResult = {};
        try {
            const finalRes = await runFinalSynth(
                cv, imageUrl, ragPack, analyzeMode, title, context
            );
            finalResult = finalRes.result;
            if (onStage) await onStage('final', { status: 'ok', result: finalResult, debug: finalRes._debug });
        } catch (e) {
            throw new PipelineError('final_strategist', `Strategist failed: ${e.message}`);
        }

        if (stageMode === 'final') return finalResult;

        // ============================================================
        // 6. NORMALIZE — Validate output (same as before)
        // ============================================================
        let normalized = {};
        try {
            normalized = normalizeOutput(finalResult);
        } catch (e) {
            throw new PipelineError('normalize', `Normalization failed: ${e.message}`);
        }

        return normalized;

    } catch (err) {
        if (err instanceof PipelineError) throw err;
        throw new PipelineError('orchestrator', `Unexpected fatal error: ${err.message}`);
    }
}

module.exports = { analyzePipeline, PipelineError };
