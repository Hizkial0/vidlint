/**
 * Stage: YouTube Retriever
 *
 * Searches YouTube Data API v3 using query_pack from Gemini Intent.
 * Returns deduplicated candidate list for similarity reranking.
 *
 * Fail-fast: throws if count == 0.
 */

const fetch = require('node-fetch');

const YT_API_KEY = process.env.YOUTUBE_API_KEY;
const YT_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const YT_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

const MAX_RESULTS_PER_QUERY = 10;
const MAX_QUERY_VARIANTS = 4;
const DURATION_BUCKETS = ['medium', 'long']; // block short-form at source
const MIN_LONGFORM_SEC = 240; // 4 minutes
const SHORTS_REGEX = /(^|[\s#])(shorts?|ytshorts)(\b|$)/i;
const DEFAULT_NEGATIVE = ['shorts', 'short', 'ytshorts', 'clip', 'clips'];

function toInt(v, fallback = 0) {
    const n = parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) ? n : fallback;
}

function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

// PT1H2M3S -> seconds
function isoDurationToSeconds(iso = 'PT0S') {
    const m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    const h = toInt(m[1], 0);
    const min = toInt(m[2], 0);
    const s = toInt(m[3], 0);
    return h * 3600 + min * 60 + s;
}

function pickThumb(thumbnails = {}) {
    // prefer highest available with dimensions
    return (
        thumbnails.maxres ||
        thumbnails.standard ||
        thumbnails.high ||
        thumbnails.medium ||
        thumbnails.default ||
        null
    );
}

async function searchYouTube(query, filters = {}, videoDuration = 'medium') {
    // 1. Sanitize & Construct Params
    const safeParams = {};

    // Required
    if (!query || !query.trim()) throw new Error("Missing query");
    safeParams.part = 'snippet';
    safeParams.q = query.trim();
    safeParams.type = 'video';
    safeParams.maxResults = String(MAX_RESULTS_PER_QUERY);
    safeParams.order = 'relevance';
    safeParams.key = YT_API_KEY;

    // Optional: videoDuration (enum)
    if (['any', 'short', 'medium', 'long'].includes(videoDuration)) {
        safeParams.videoDuration = videoDuration;
    }

    // Optional: publishedAfter (date)
    if (filters.published_after_days && filters.published_after_days > 0) {
        const after = new Date();
        after.setDate(after.getDate() - Number(filters.published_after_days));
        if (!isNaN(after.getTime())) {
            safeParams.publishedAfter = after.toISOString();
        }
    }

    // Optional: relevanceLanguage (string, 2 chars)
    // "null" string check is CRITICAL here
    if (filters.relevance_language &&
        filters.relevance_language !== 'null' &&
        filters.relevance_language.length === 2) {
        safeParams.relevanceLanguage = filters.relevance_language;
    }

    // Optional: regionCode (string, 2 chars)
    if (filters.region_code &&
        filters.region_code !== 'null' &&
        filters.region_code.length === 2) {
        safeParams.regionCode = filters.region_code;
    }

    const params = new URLSearchParams(safeParams);

    // 2. Log Outgoing Request (One-time debug)
    console.log(`[YouTube] Search Params: ${params.toString()}`);

    const res = await fetch(`${YT_SEARCH_URL}?${params}`);
    if (!res.ok) {
        const txt = await res.text();
        // Log detailed error for debugging
        console.error(`[YouTubeParams] Failed URL: ${YT_SEARCH_URL}?${params}`);
        throw new Error(`YouTube search failed (${res.status}): ${txt}`);
    }

    const data = await res.json();
    return (data.items || []).map(item => ({
        videoId: item.id.videoId,
        title: item.snippet.title || '',
        description: item.snippet.description || '',
        channelId: item.snippet.channelId || '',
        publishedAt: item.snippet.publishedAt || '',
        snippetThumb: pickThumb(item.snippet.thumbnails)?.url || ''
    }));
}

async function hydrateVideoMeta(videoIds) {
    if (!videoIds.length) return {};

    const idChunks = chunk(videoIds, 50); // API max ids per call
    const meta = {};

    for (const ids of idChunks) {
        const params = new URLSearchParams({
            part: 'snippet,contentDetails,statistics',
            id: ids.join(','),
            key: YT_API_KEY
        });

        const res = await fetch(`${YT_VIDEOS_URL}?${params}`);
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`YouTube videos.list failed (${res.status}): ${txt}`);
        }

        const data = await res.json();
        for (const item of data.items || []) {
            const t = pickThumb(item.snippet?.thumbnails);
            meta[item.id] = {
                viewCount: toInt(item.statistics?.viewCount, 0),
                likeCount: toInt(item.statistics?.likeCount, 0),
                durationSec: isoDurationToSeconds(item.contentDetails?.duration || 'PT0S'),
                title: item.snippet?.title || '',
                description: item.snippet?.description || '',
                tags: item.snippet?.tags || [],
                thumbnailUrl: t?.url || '',
                thumbWidth: toInt(t?.width, 0),
                thumbHeight: toInt(t?.height, 0)
            };
        }
    }

    return meta;
}

function applyNegativeFilter(candidates, negativeQueries) {
    const mergedNeg = [
        ...DEFAULT_NEGATIVE,
        ...(Array.isArray(negativeQueries) ? negativeQueries : [])
    ]
        .map(s => String(s).trim().toLowerCase())
        .filter(Boolean);

    if (!mergedNeg.length) return candidates;

    return candidates.filter(c => {
        const hay = `${c.title} ${c.description}`.toLowerCase();
        return !mergedNeg.some(neg => hay.includes(neg));
    });
}

function isShortLike(item) {
    const textBlob = `${item.title || ''} ${item.description || ''} ${(item.tags || []).join(' ')}`;
    const hasShortWord = SHORTS_REGEX.test(textBlob);
    const tooShort = (item.durationSec || 0) < MIN_LONGFORM_SEC;
    const verticalThumb =
        (item.thumbHeight || 0) > 0 &&
        (item.thumbWidth || 0) > 0 &&
        item.thumbHeight > item.thumbWidth;

    return hasShortWord || tooShort || verticalThumb;
}

async function runYouTubeRetriever(queryPack) {
    const {
        query_variants = [],
        negative_queries = [],
        retrieval_filters = {}
    } = queryPack || {};

    const debug = {
        stage: 'youtube_retriever',
        latencyMs: 0,
        status: 'pending',
        queriesRun: 0,
        rawCount: 0,
        dedupedCount: 0,
        hydratedCount: 0,
        afterNegativeCount: 0,
        afterShortRejectCount: 0
    };

    const start = Date.now();

    if (!YT_API_KEY) throw new Error('Missing YOUTUBE_API_KEY');
    if (!query_variants.length) {
        console.warn('[YouTubeRetriever] No query variants. Skipping.');
        return { result: { candidates: [], count: 0 }, _debug: debug };
    }

    const baseQueries = query_variants.slice(0, MAX_QUERY_VARIANTS);

    // Add exclusion tokens directly in query for first-pass filtering
    const safeQueries = baseQueries.map(
        q => `${q} -shorts -short -ytshorts -clip -clips`
    );

    // Search across medium + long buckets
    const tasks = [];
    for (const q of safeQueries) {
        for (const bucket of DURATION_BUCKETS) {
            tasks.push(searchYouTube(q, retrieval_filters, bucket));
        }
    }
    debug.queriesRun = tasks.length;

    const searchResults = await Promise.all(tasks);
    const flat = searchResults.flat();
    debug.rawCount = flat.length;

    // Dedupe by videoId
    const seen = new Set();
    let candidates = [];
    for (const item of flat) {
        if (!item.videoId || seen.has(item.videoId)) continue;
        seen.add(item.videoId);
        candidates.push(item);
    }
    debug.dedupedCount = candidates.length;

    // Negative keyword filter
    candidates = applyNegativeFilter(candidates, negative_queries);
    debug.afterNegativeCount = candidates.length;

    // Hydrate with metadata (duration, stats, better thumb)
    const videoIds = candidates.map(c => c.videoId);
    const meta = await hydrateVideoMeta(videoIds);

    candidates = candidates.map(c => {
        const m = meta[c.videoId] || {};
        return {
            ...c,
            viewCount: m.viewCount || 0,
            likeCount: m.likeCount || 0,
            durationSec: m.durationSec || 0,
            tags: m.tags || [],
            thumbnailUrl: m.thumbnailUrl || c.snippetThumb || '',
            thumbWidth: m.thumbWidth || 0,
            thumbHeight: m.thumbHeight || 0,
            // prefer canonical snippet from videos.list
            title: m.title || c.title,
            description: m.description || c.description
        };
    });
    debug.hydratedCount = candidates.length;

    // HARD reject Shorts / short-like content
    candidates = candidates.filter(c => !isShortLike(c));
    debug.afterShortRejectCount = candidates.length;

    // WARN but don't fail if empty
    if (candidates.length === 0) {
        console.warn('[YouTubeRetriever] Returned 0 long-form candidates after filtering. Pipeline will continue without references.');
    }

    // Optional stable sort for downstream
    candidates.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));

    debug.latencyMs = Date.now() - start;
    debug.status = 'ok';

    const result = { candidates, count: candidates.length };
    console.log(
        `[YouTubeRetriever] OK in ${debug.latencyMs}ms | final=${result.count} | raw=${debug.rawCount} | dedup=${debug.dedupedCount} | shortRejected=${debug.afterNegativeCount - debug.afterShortRejectCount}`
    );

    return { result, _debug: debug };

}

module.exports = { runYouTubeRetriever };
