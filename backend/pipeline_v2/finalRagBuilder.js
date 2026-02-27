/**
 * Stage: Final RAG Builder
 *
 * Tiny context packer. No more "merge everything" evidence sludge.
 * Packs router output + top local refs + top YouTube refs into a minimal
 * object that the Final Decider can consume.
 */

function buildFinalRag(routerOutput, localRefs, ytRefs) {
    const debug = {
        stage: 'final_rag_builder',
        latencyMs: 0,
        status: 'pending'
    };
    const start = Date.now();

    try {
        // Cap refs to strict limits
        const topLocalRefs = (Array.isArray(localRefs) ? localRefs : [])
            .slice(0, 3)
            .map(ref => ({
                title: ref.title || '',
                thumbnailUrl: ref.thumbnailUrl || '',
                channel: ref.channelId || ref.channel || '',
                outlierScore: ref.outlierScore || 0,
                reason: ref.reason || `Distance: ${(ref.matchDistance || 0).toFixed(3)}`
            }));

        const topYoutubeRefs = (Array.isArray(ytRefs) ? ytRefs : [])
            .slice(0, 2)
            .map(ref => ({
                title: ref.title || '',
                thumbnailUrl: ref.thumbnailUrl || '',
                channel: ref.channel || ref.channelId || '',
                views: ref.views || ref.viewCount || 0,
                reason: ref.reason || 'YouTube reference'
            }));

        const ragPack = {
            routerOutput: routerOutput || {},
            topLocalRefs,
            topYoutubeRefs
        };

        debug.latencyMs = Date.now() - start;
        debug.status = 'ok';
        debug.localCount = topLocalRefs.length;
        debug.ytCount = topYoutubeRefs.length;

        console.log(
            `[FinalRagBuilder] OK in ${debug.latencyMs}ms | ` +
            `${topLocalRefs.length} local + ${topYoutubeRefs.length} yt = ${topLocalRefs.length + topYoutubeRefs.length} total`
        );

        return { result: ragPack, _debug: debug };

    } catch (err) {
        debug.latencyMs = Date.now() - start;
        debug.error = err.message;
        debug.status = 'error';
        console.error(`[FinalRagBuilder] FAILED: ${err.message}`);
        throw err;
    }
}

module.exports = { buildFinalRag };
