/* --- DATA NORMALIZATION --- */
function normalizeAnalysisResult(raw) {
    if (!raw) return null;

    // 1. Separate _meta 
    // (We keep it on the object for debug, but don't depend on it for rendering)
    const { _meta, ...core } = raw || {};

    // 2. Initialize Canonical Object with defaults
    const normalized = {
        _meta,
        score: 0,
        scoreColor: "#ff3b3b", // Default to red
        verdict: "Analysis Incomplete",
        fixes: [],
        comps: [], // Mapped from layoutOptions
        topProblems: [],
        blockers: [],
        metrics: [] // The field causing the crash
    };

    // 3. Extract Score & core fields
    // Handle both direct score (legacy/local) and rating.total (V2)
    if (typeof core.score === 'number') {
        normalized.score = core.score;
    } else if (core.rating && typeof core.rating.total === 'number') {
        normalized.score = core.rating.total;
    }

    // 4. Ensure Arrays
    if (Array.isArray(core.fixes)) normalized.fixes = core.fixes;
    if (Array.isArray(core.topProblems)) normalized.topProblems = core.topProblems;

    // 5. Map Blockers
    // V2 uses rating.focus, Legacy uses blockers or weakest
    if (core.rating && Array.isArray(core.rating.focus)) {
        normalized.blockers = core.rating.focus;
    } else if (Array.isArray(core.blockers)) {
        normalized.blockers = core.blockers;
    } else if (Array.isArray(core.weakest)) {
        normalized.blockers = core.weakest;
    }

    // 6. Map Comps (Layout Options)
    // V2 returns layoutOptions, Frontend expects comps
    const rawLayouts = Array.isArray(core.layoutOptions) ? core.layoutOptions :
        (Array.isArray(core.comps) ? core.comps : []);

    if (rawLayouts.length > 0) {
        normalized.comps = rawLayouts.map((lo, i) => ({
            label: lo.label || (i === 0 ? "A" : "B"),
            title: lo.title || lo.name || "Layout Option",
            desc: lo.desc || lo.goal || "",
            moves: lo.moves || []
        }));
    }

    // 7. Map Metrics (Crucial for Line 721 crash)
    // V2 returns rating object, Frontend expects metrics array
    if (core.rating) {
        const metricKeys = ['POP', 'CLARITY', 'HOOK', 'CLEAN', 'TRUST'];
        normalized.metrics = metricKeys.map(key => {
            const m = core.rating[key] || { val: 0, why: '' };
            const val = typeof m.val === 'number' ? m.val : 0;
            // Color logic: <10 red, <15 yellow, >=15 green
            const color = val >= 15 ? "#4ade80" : val >= 10 ? "#fbbf24" : "#ff3b3b";

            return {
                label: key,
                val: val,
                max: 20,
                color: color,
                why: m.why || "No details provided."
            };
        });
    } else if (Array.isArray(core.metrics)) {
        // Legacy/Local pass-through
        normalized.metrics = core.metrics;
    }

    // 8. Derive Score Props (Color/Verdict) based on finalized score
    if (normalized.score >= 80) normalized.scoreColor = "#4ade80";
    else if (normalized.score >= 60) normalized.scoreColor = "#fbbf24";

    // Use provided verdict or derive
    if (core.verdict) {
        normalized.verdict = core.verdict;
    } else {
        normalized.verdict = normalized.score >= 90 ? "Excellent" :
            normalized.score >= 75 ? "Good" :
                normalized.score >= 50 ? "Needs Work" : "Critical Fixes Needed";
    }

    return normalized;
}
