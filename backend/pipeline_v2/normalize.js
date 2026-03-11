/**
 * Core Pipeline: Normalize Output
 * 
 * Responsibilities:
 * 1. SCRUB internal IDs (hero_1, etc) from ALL user text.
 * 2. RESOLVE friendly names (Trust LLM or leave empty).
 * 3. CLAMP metrics.
 * 4. DERIVE applyTo fields.
 */

// Rigorous Regex for scrubbing
const ID_REGEX = /\b(hero_\d+|hook_\d+|bg_\d+|global|face_\d+|obj_\d+|text_\d+)\b/gi;

function scrubText(text) {
    if (!text || typeof text !== 'string') return "";

    // Replace specific IDs with context-aware generic terms
    return text
        .replace(/\bhero_\d+\b/gi, "the main subject")
        .replace(/\bhook_\d+\b/gi, "the key element")
        .replace(/\bbg_\d+\b/gi, "the background")
        .replace(/\bglobal\b/gi, "the image")
        .replace(/\bface_\d+\b/gi, "the face")
        .replace(/\btext_\d+\b/gi, "the text")
        .replace(/\bobj_\d+\b/gi, "the object")
        // Catch-all for any remaining IDs or double spaces
        .replace(ID_REGEX, "the element")
        .replace(/\s+/g, ' ')
        .trim();
}

function resolveDisplayTarget(fix) {
    // Trust LLM's displayTarget if present and meaningful
    if (fix.displayTarget && fix.displayTarget.trim().length > 0) {
        return fix.displayTarget;
    }
    // Otherwise leave empty. Do NOT invent "Main Subject".
    return "";
}

function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
}

function normalizeRating(rating) {
    if (!rating) return {};

    // Ensure numeric fields are 0-20
    for (const key of ['POP', 'CLARITY', 'HOOK', 'CLEAN', 'TRUST']) {
        if (rating[key]) {
            rating[key].val = clamp(rating[key].val || 0, 0, 20);
            rating[key].max = 20;
            if (rating[key].why) rating[key].why = scrubText(rating[key].why);
        }
    }
    rating.total = clamp(rating.total || 0, 0, 100);
    return rating;
}

function normalizeOutput(result) {
    if (!result) return null;

    // 1. Scrub Fixes
    if (result.fixes && Array.isArray(result.fixes)) {
        result.fixes = result.fixes.map(fix => {
            fix.title = scrubText(fix.title);
            fix.why = scrubText(fix.why);
            fix.instruction = scrubText(fix.instruction);
            fix.displayTarget = resolveDisplayTarget(fix);

            // Derive applyTo
            const applyTo = new Set();
            if (fix.ops) {
                fix.ops.forEach(op => {
                    if (op.target !== 'global') applyTo.add(op.target);
                });
            }
            fix.applyTo = Array.from(applyTo);

            return fix;
        });
    }

    // 2. Scrub Ratings
    if (result.rating) {
        result.rating = normalizeRating(result.rating);
    }

    // 3. Scrub Weakness Reasons
    if (result.weaknessRanking && Array.isArray(result.weaknessRanking)) {
        result.weaknessRanking.forEach(w => {
            if (w.reason) w.reason = scrubText(w.reason);
        });
    }

    // 4. Scrub Layouts (A/B)
    if (result.layoutOptions) {
        if (!Array.isArray(result.layoutOptions) || result.layoutOptions.length < 2 || result.layoutOptions.length > 3) {
            // Fail Fast - contract requires 2-3 options
            throw new Error("Contract violation: layoutOptions must have 2 to 3 items.");
        }
        result.layoutOptions.forEach(l => {
            if (l.name) l.name = scrubText(l.name);
            if (l.title) l.title = scrubText(l.title);
            if (l.goal) l.goal = scrubText(l.goal);
            if (l.moves && Array.isArray(l.moves)) {
                l.moves = l.moves.map(m => scrubText(m));
            }
        });
    }



    return result;
}

module.exports = { normalizeOutput };
