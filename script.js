let currentResult = null; // Holds the normalized result object
let openFixIndex = 0;
let currentTab = "normal";

// --- ANALYSIS CACHE ---
// Stores results by mode to avoid re-analyzing when switching tabs
const analysisCache = {
    fast: null,
    normal: null,
    deep: null
};

// --- API CONFIGURATION ---
const API_CONFIG = {
    // Local development backend
    baseUrl: "http://localhost:8787",
    // Set to true to use live LLM backend, false for local mock data
    useLiveBackend: true // ✅ ENABLED - Using OpenAI Vision
};

/**
 * Call the backend API for LLM-powered analysis
 * @param {Object} payload - Request body matching api_contract.json
 * @returns {Promise<Object>} - Analysis result
 */
async function fetchBackendAnalysis(payload) {
    const url = `${API_CONFIG.baseUrl}/analyze`;
    console.log("[API] Calling backend:", url, payload);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log("[API] Backend response:", data);

        // Map 'layouts' to 'comps' for frontend compatibility
        if (data.layouts && !data.comps) {
            data.comps = data.layouts;
        } else if (data.layoutOptions && !data.comps) {
            // Support 'layoutOptions' key from V2
            data.comps = data.layoutOptions.map((lo, i) => ({
                label: lo.label || (i === 0 ? "A" : "B"),
                title: lo.name,
                desc: lo.goal,
                moves: lo.moves || []
            }));

            // Fixes should already be there, but maybe renamed/structured?
            // V2 returns 'fixes' array, compatible.
        }

        // --- MAP V2 RATINGS TO METRICS ARRAY ---
        if (data.rating) {
            data.score = data.rating.total;

            // Derive color
            data.scoreColor = data.score >= 80 ? "#4ade80" :
                data.score >= 60 ? "#fbbf24" : "#ff3b3b";

            // Derive verdict
            data.verdict = data.score >= 90 ? "Excellent" :
                data.score >= 75 ? "Good" :
                    data.score >= 50 ? "Needs Work" : "Critical Fixes Needed";

            // Map blockers (weakest buckets)
            data.blockers = data.rating.focus || [];

            // Map metrics object to array
            const metricKeys = ['POP', 'CLARITY', 'HOOK', 'CLEAN', 'TRUST'];
            data.metrics = metricKeys.map(key => {
                const m = data.rating[key] || { val: 0, why: '' };
                const val = m.val || 0;
                // Color logic: <10 red, <15 yellow, >=15 green (assuming max 20)
                const color = val >= 15 ? "#4ade80" : val >= 10 ? "#fbbf24" : "#ff3b3b";

                return {
                    label: key,
                    val: val,
                    max: 20,
                    color: color,
                    why: m.why || "No details provided."
                };
            });
        }


        return data;
    } catch (error) {
        console.error("[API] Backend error:", error);
        throw error;
    }
}

/**
 * Build the API request payload from current state
 */
function buildApiPayload(mode, metrics) {
    let payload = { mode, analyzeMode: mode };

    // Get stored data
    try {
        const stored = localStorage.getItem("linter_data");
        if (stored) {
            const data = JSON.parse(stored);
            payload.game = data.game || "gta";
            payload.title = data.title || "";
            payload.context = data.context || "";
            payload.publicId = data.publicId || "";
            payload.imageUrlSmall = data.imageUrlSmall || "";
            if (data.mode) payload.analyzeMode = data.mode;
        }
    } catch (e) {
        console.warn("Failed to read linter_data from localStorage");
    }

    // Note: retinaMetrics are computed locally but NOT sent to the backend.
    // The LLM judges the image directly, not pseudo-scientific numbers.

    return payload;
}

// --- Loading Overlay Functions ---
function showLoading(text = "Analyzing with AI...", subtext = "This may take a few seconds") {
    const overlay = document.getElementById('loading-overlay');
    const textEl = document.getElementById('loading-text');
    const subtextEl = document.getElementById('loading-subtext');

    if (overlay) {
        overlay.classList.remove('error');
        if (textEl) textEl.textContent = text;
        if (subtextEl) subtextEl.textContent = subtext;
        overlay.style.display = 'flex';
    }
}

function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.display = 'none';
        overlay.classList.remove('error');
    }
}

function showLoadingError(message) {
    const overlay = document.getElementById('loading-overlay');
    const textEl = document.getElementById('loading-text');
    const subtextEl = document.getElementById('loading-subtext');

    if (overlay) {
        overlay.classList.add('error');
        if (textEl) textEl.textContent = '❌ Analysis Failed';
        if (subtextEl) subtextEl.textContent = message;

        // Auto-hide after 3 seconds
        setTimeout(() => {
            hideLoading();
        }, 4000);
    }
}

/**
 * Unified analysis function - backend ONLY (no fallback to demo data)
 * @param {string} mode - 'finished' or 'draft'
 * @param {Object} metrics - retinaMetrics from canvas analysis
 * @returns {Promise<Object>} - Analysis result from OpenAI
 */
async function runAnalysis(mode, metrics) {
    if (!API_CONFIG.useLiveBackend) {
        // If backend disabled, use local mock (for testing without API)
        return analyzeLocal(mode, metrics);
    }

    // --- LIVE BACKEND PATH ---
    showLoading("🔍 Analyzing thumbnail...", "Connecting to AI backend");

    try {
        const payload = buildApiPayload(mode, metrics);

        // Validate we have required data
        if (!payload.imageUrlSmall) {
            throw new Error("No image uploaded. Please upload a thumbnail first.");
        }

        // Generate the central hash key based on the image being sent to the backend
        const imageHash = payload.imageUrlSmall.substring(0, 100);

        showLoading("🤖 Processing with OpenAI...", "Analyzing composition, clarity, and more");

        const result = await fetchBackendAnalysis(payload);

        // Save successful result to localStorage cache
        try {
            localStorage.setItem('linter_analysis_hash', imageHash);
            localStorage.setItem('linter_analysis_' + mode, JSON.stringify(result));
        } catch (e) {
            console.warn("[CACHE] Failed to save to localStorage (quota exceeded?)");
        }

        hideLoading();
        return result;

    } catch (error) {
        console.error("[runAnalysis] Backend error:", error.message);

        // Show specific error messages
        let userMessage = error.message;
        if (error.message.includes('Failed to fetch') || error.message.includes('ERR_CONNECTION')) {
            userMessage = "Backend not running. Start it with: npm start (in backend folder)";
        } else if (error.message.includes('Invalid OpenAI')) {
            userMessage = "Invalid API key. Check your .env file.";
        }

        showLoadingError(userMessage);
        throw error; // Re-throw so caller knows it failed
    }
}

/**
 * Show analysis error in UI (non-blocking toast)
 */
function showAnalysisError(message) {
    const toast = document.getElementById('toast');
    if (toast) {
        const originalText = toast.textContent;
        toast.textContent = `⚠️ ${message}`;
        toast.style.background = '#ef4444';
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
            toast.textContent = originalText;
            toast.style.background = '';
        }, 3000);
    }
}

const els = {
    tabs: document.querySelectorAll(".tab-btn"),
    scoreRing: document.getElementById("main-score-ring"),
    scoreValue: document.getElementById("main-score"),
    scoreText: document.getElementById("score-text"),
    verdictText: document.getElementById("verdict-text"),
    weakestText: document.querySelector(".highlight-weak"),
    metricsGrid: document.getElementById("metrics-grid"),
    fixList: document.getElementById("fix-list"),
    accContent: document.getElementById("accordion-content"),
    accChevron: document.getElementById("accordion-chevron"),
    toast: document.getElementById("toast"),
};

/* --- DATA NORMALIZER --- */
function normalizeResult(raw, mode) {
    console.log("[NORMALIZE] Input raw data:", raw);
    const res = { ...raw, mode };

    // --- 1. Score & Metrics ---
    if (raw.rating) {
        res.score = raw.rating.total || 0;

        // Map score to color
        if (res.score >= 80) res.scoreColor = "#4ade80"; // Green
        else if (res.score >= 60) res.scoreColor = "#fbbf24"; // Yellow
        else res.scoreColor = "#ff3b3b"; // Red

        res.verdict = res.score >= 80 ? "PUBLISH" : "FIX then publish";

        // Map rating object to metrics array
        // Expected UI: [{ label, val, max, color }]
        const bucketKeys = ['POP', 'CLARITY', 'HOOK', 'CLEAN', 'TRUST'];
        res.metrics = bucketKeys.map(key => {
            const item = raw.rating[key] || { val: 0 };
            const val = item.val || 0;
            let color = "#ff3b3b";
            if (val >= 15) color = "#4ade80";
            else if (val >= 10) color = "#fbbf24";

            return {
                label: key,
                val: val,
                max: 20,
                color: color,
                why: item.why || "No explanation available." // Map explanation
            };
        });
    }

    // --- 2. Blockers (Weakest) ---
    if (raw.weaknessRanking) {
        res.blockers = raw.weaknessRanking.map(w => w.area).slice(0, 2);
    }
    if (!res.blockers || res.blockers.length === 0) res.blockers = ["None", "None"];

    // --- 3. Fixes (Quick Win Only) ---
    // Core pipeline returns flat 'fixes' array. 
    // Logic: First 3 -> Quick Wins.

    // Map backend fix structure to frontend structure
    const mappedFixes = (raw.fixes || []).map(f => ({
        priority: f.priority || "P1",
        pts: f.pts || "+5",
        title: f.title,
        measurableFix: f.instruction || f.why,
        detail: f.why,
        applyTo: f.applyTo
    }));

    res.quickWinPlan = {
        time: "10-25 min",
        fixes: mappedFixes.slice(0, 5) // Allowed up to 5 instead of 3
    };

    // --- 4. Layout Options (Formerly High Impact) ---
    // Maps to the UI panel #high-impact-panel (renamed Layout Options)
    // Structure: { fixes: [ { priority: "Option A", ... }, { priority: "Option B", ... } ] }
    if (raw.layoutOptions && Array.isArray(raw.layoutOptions) && raw.layoutOptions.length >= 2) {
        res.highImpactPlan = {
            time: "", // No time needed
            fixes: raw.layoutOptions.map((l, i) => {
                const letter = String.fromCharCode(65 + i); // 0 -> A, 1 -> B, 2 -> C
                return {
                    priority: `Option ${letter}`,
                    pts: "", // No pts
                    title: l.title || l.label || `Layout ${letter}`,
                    goal: l.goal, // Pass through for new renderer
                    moves: l.moves, // Pass through for new renderer
                    // Fallbacks for safety
                    measurableFix: l.goal || "No goal provided",
                    detail: Array.isArray(l.moves) ? l.moves.join("; ") : (l.moves || ""),
                    applyTo: []
                };
            })
        };
    } else {
        // Fallback or empty
        res.highImpactPlan = { fixes: [] };
    }



    return res;
}


/* --- LOCAL ANALYSIS ENGINE --- */
function analyzeLocalOld(mode, metrics) {
    const isFinished = mode === 'finished';
    let result = {};

    // Base templates
    if (isFinished) {
        result = {
            score: 93,
            scoreColor: "#4ade80",
            verdict: "FIX then publish",
            weakest: ["None"],
            metrics: [
                { label: "POP", val: 19, max: 20, color: "#4ade80" },
                { label: "CLARITY", val: 18, max: 20, color: "#4ade80" },
                { label: "HOOK", val: 17, max: 20, color: "#4ade80" },
                { label: "CLEAN", val: 20, max: 20, color: "#4ade80" },
                { label: "TRUST", val: 19, max: 20, color: "#4ade80" },
            ],
            fixes: [
                { pClass: "low", priority: "LOW", time: "2m", pts: "+2", title: "Optimized Images", impact: "Performance", detail: "Images are compressed and lazy-loaded.", desc: "Ensure all images utilize the 'loading=lazy' attribute and are served in WEBP format." },
                { pClass: "med", priority: "MED", time: "5m", pts: "+5", title: "Color Contrast", impact: "Accessibility", detail: "Some text elements have low contrast ratios.", desc: "Increase the opacity of secondary text or darken the background." },
                { pClass: "low", priority: "LOW", time: "3m", pts: "+3", title: "Mobile Padding", impact: "Usability", detail: "Touch targets are too close on mobile.", desc: "Increase padding around interactive elements to at least 44px." }
            ],
            comps: [
                { label: "A", title: "Standard Grid", desc: "Clean 3-column layout" },
                { label: "B", title: "Featured Hero", desc: "Large hero with 2-column sub-grid" },
                { label: "C", title: "Minimal List", desc: "Simple list view for data-heavy pages" }
            ]
        };
    } else {
        result = {
            score: 43,
            scoreColor: "#ff3b3b",
            verdict: "FIX then publish",
            weakest: ["CLARITY", "HOOK"],
            metrics: [
                { label: "CLARITY", val: 10, max: 25, color: "#ff3b3b" },
                { label: "HOOK", val: 8, max: 25, color: "#ff3b3b" },
                { label: "VISUALABILITY", val: 15, max: 25, color: "#fbbf24" },
                { label: "CLEAN", val: 10, max: 25, color: "#fbbf24" },
            ],
            fixes: [
                { pClass: "high", priority: "HIGH", time: "15m", pts: "+15", title: "Fix Navigation Alignment", impact: "High Impact", detail: "Navigation items are not aligned with the logo.", desc: "Align navigation items significantly to the right to balance the header." },
                { pClass: "med", priority: "MED", time: "8m", pts: "+8", title: "Increase Contrast", impact: "Legibility", detail: "Gray text on black background is hard to read.", desc: "Lighten the text color to at least #a1a1aa for better readability." },
                { pClass: "low", priority: "LOW", time: "3m", pts: "+3", title: "Standardize Buttons", impact: "Consistency", detail: "Buttons use different border radii.", desc: "Set all button border-radius to 4px for consistency." }
            ],
            comps: [
                { label: "A", title: "Sidebar Layout", desc: "Vertical navigation on the left, content on the right." },
                { label: "B", title: "Top Bar Layout", desc: "Horizontal navigation at the top, centered content." },
                { label: "C", title: "Grid Layout", desc: "Dashboard style grid with widget cards." }
            ]
        };
    }

    // DYNAMIC INJECTION: If Mobile Test Failed, inject a critical fix
    if (metrics && metrics.mobile && !metrics.mobile.pass) {
        // Add to top of fixes
        result.fixes.unshift({
            priority: "CRITICAL",
            title: "Safe Area Fail",
            detail: "Your thumbnail loses critical detail when scaled down.",
            measurableFix: "The edge density or contrast is too low for small screens. Increase contrast or zoom in on the subject."
        });

        // Penalize score
        result.score = Math.max(0, result.score - 15);

        // Update weak list
        if (!result.weakest.includes("MOBILE")) {
            if (result.weakest[0] === "None") result.weakest = [];
            result.weakest.push("VISIBILITY");
        }
    }

    return result;
}

/* --- RENDER FUNCTIONS --- */

function renderPlan(containerId, planData) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!planData || !planData.fixes) {
        container.innerHTML = `<div class="p-4 text-white/50 text-sm">No plan data available</div>`;
        return;
    }

    // Update time pill if it exists in header - REMOVED logic
    // const timeId = containerId === 'quick-win-fixes' ? 'time-quick' : 'time-high';
    // const timeEl = document.getElementById(timeId);
    // if (timeEl && planData.time) timeEl.textContent = planData.time;

    container.innerHTML = planData.fixes.map((fix, i) => {
        // map P1/P2/P3 to CSS class
        const pClass = (fix.priority || 'MED').toLowerCase().replace(" ", "");
        const uniqueId = `${containerId}-${i}`;

        // DETECT TYPE: Layout vs Standard Fix
        // Layouts have 'moves' array or 'goal' string
        const isLayout = Array.isArray(fix.moves) || typeof fix.moves === 'string';

        // Prepare content variables
        let mainContentHtml = '';
        let buttonText = 'Copy Fix';
        let copyContent = fix.measurableFix || '';

        if (isLayout) {
            // NEW HIERARCHY FOR LAYOUTS: 
            // 1. Goal (Small/Muted)
            // 2. Moves (Big/List)

            const goalHtml = fix.goal ? `<div class="layout-goal">${fix.goal}</div>` : '';

            // Ensure moves is a list
            let movesList = [];
            if (Array.isArray(fix.moves)) movesList = fix.moves;
            else if (typeof fix.moves === 'string') movesList = [fix.moves];

            const movesHtml = movesList.length > 0
                ? `<ol class="layout-moves-list">${movesList.map(m => `<li>${m}</li>`).join('')}</ol>`
                : '<div class="text-white/50 text-sm">No steps provided</div>';

            mainContentHtml = `${goalHtml}<div class="layout-moves-container">${movesHtml}</div>`;
            buttonText = 'Copy Steps';

            // Copy content is the steps joined
            copyContent = movesList.join('\n');

        } else {
            // STANDARD FIX HIERARCHY
            // 1. Detail (Diagnosis) - italic
            // 2. Measurable Fix (Action) - main block

            const detailHtml = fix.detail ? `<div class="fix-detail">${fix.detail}</div>` : '';
            const actionHtml = fix.measurableFix ? `<div class="fix-measurables">${fix.measurableFix}</div>` : '';

            mainContentHtml = `<div class="fix-content-block">${detailHtml}${actionHtml}</div>`;
            buttonText = 'Generate Fix';
        }

        // Safe copy string
        const safeCopy = (copyContent || '').replace(/'/g, "\\'").replace(/\n/g, '\\n');

        let actionHtml = '';
        if (isLayout) {
            actionHtml = `<button class="btn-copy-fix" onclick="copyText('${safeCopy}')">${buttonText}</button>`;
        } else {
            actionHtml = `
                <select class="strength-select" id="strength-${uniqueId}" style="background:rgba(255,255,255,0.1); color:#fff; border:1px solid rgba(255,255,255,0.2); padding:4px 8px; border-radius:4px; font-size:0.75rem; outline:none; margin-right: 8px;">
                    <option value="low">Low (Fast)</option>
                    <option value="high" selected>High (Best)</option>
                </select>
                <button class="btn-copy-fix btn-generate-fix" id="btn-gen-${uniqueId}" style="background: var(--color-primary); color: white; border: none; box-shadow: 0 0 10px rgba(59, 130, 246, 0.4);" onclick="generateFix('${uniqueId}', ${i}, '${containerId}')">${buttonText}</button>
            `;
        }

        return `
        <div class="fix-item" id="${uniqueId}" data-apply-to='${JSON.stringify(fix.applyTo || [])}'>
            <div class="fix-header" onclick="toggleFix('${uniqueId}')">
                <div class="priority-chip p-${pClass}">${fix.priority}</div>
                <span class="fix-title-text">${fix.title}</span>
                <span class="fix-chevron">▾</span>
            </div>
            
            <div class="fix-body">
                 ${mainContentHtml}
                 <div class="fix-actions" style="display:flex; align-items:center; justify-content:flex-end;">
                    ${actionHtml}
                 </div>
            </div>
        </div>
        `;
    }).join("");
}

/* --- REGION HIGHLIGHTING --- */

function clearHighlights() {
    const overlays = document.getElementById("region-overlays");
    if (overlays) overlays.innerHTML = "";
}

function highlightRegions(regionIds) {
    if (!currentResult || !currentResult._regions) return;
    const overlays = document.getElementById("region-overlays");
    if (!overlays) return;

    clearHighlights();

    regionIds.forEach(id => {
        // Handle special IDs
        if (['hero', 'background', 'composition'].includes(id)) {
            // Find the most relevant region for "hero"
            if (id === 'hero') {
                const heroRegion = currentResult._regions.find(r => r.type === 'hero' || r.id === 'hero' || r.type === 'face');
                if (heroRegion) highlightSingleRegion(heroRegion, overlays);
            }
            return;
        }

        const region = currentResult._regions.find(r => r.id === id);
        if (region) {
            highlightSingleRegion(region, overlays);
        }
    });
}

function highlightSingleRegion(region, container) {
    const img = document.getElementById('main-thumbnail');
    // Targeted: Use preview-container if available, else card
    const card = document.querySelector('.preview-container') || document.querySelector('.thumbnail-card');

    // Guard: image not loaded yet
    if (!img || !img.naturalWidth || !card) return;

    // Container dimensions
    const cw = card.clientWidth, ch = card.clientHeight;
    // Image natural dimensions
    const iw = img.naturalWidth, ih = img.naturalHeight;

    // object-fit: contain scaling using actual rendered image
    // (Assuming img is 100% w/h of container or contained)
    // Actually, if we use preview-container, it wraps img tightly?
    // If img is 'contain', we need letterbox calculation.

    // Let's assume preview-container matches image aspect ratio due to layout?
    // Or recalculate like before:
    const scale = Math.min(cw / iw, ch / ih);
    const dw = iw * scale, dh = ih * scale;
    const dx = (cw - dw) / 2, dy = (ch - dh) / 2;

    // Transform region coords (0-1 normalized) to pixel position
    const x = dx + region.x * dw;
    const y = dy + region.y * dh;
    const w = region.w * dw;
    const h = region.h * dh;

    const box = document.createElement("div");
    box.className = "region-box";
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${w}px`;
    box.style.height = `${h}px`;

    // Anti-ghosting: Mark suppressed regions (CSS can hide or dim them if needed)
    if (region.isSuppressed) {
        box.dataset.suppressed = "true";
        box.style.borderStyle = "dashed"; // Visual hint for debug/targeted
        box.style.opacity = "0.7";
    }

    const label = document.createElement("div");
    label.className = "region-label";
    // Use displayName if available, fallback to type/label/id
    label.textContent = region.displayName || (region.type === 'text' ? 'TEXT' : (region.label || region.id));

    // Append first to measure
    box.appendChild(label);
    container.appendChild(box);

    // Smart Positioning (Pixel-based Collision)
    // Measure relative to container (cw)
    const labelWidth = label.offsetWidth;
    // Box absolute left in container is 'x'
    // Label default is Left:4px relative to box -> Absolute x + 4

    // Check Right Edge Collision
    // If (BoxLeft + 4 + LabelWidth) > ContainerWidth - 4
    if (x + 4 + labelWidth > cw - 4) {
        // Shift to Right Align inside box
        label.style.left = 'auto';
        label.style.right = '4px';
        label.style.textAlign = 'right';
    }

    // Check Left Edge Collision (if shifted right, does it hit left?)
    // (BoxRight - 4 - LabelWidth) < 0? 
    // Not critical for now.

    // Check Top Edge Collision (optional but good)
    // If box height is very small (< 20px), label covers content.
    // User said "default inside".
}

// Global toggle handler with highlighting
function toggleFix(id) {
    // Close others
    document.querySelectorAll('.fix-item.open').forEach(el => {
        if (el.id !== id) el.classList.remove('open');
    });

    const el = document.getElementById(id);
    if (!el) return;

    const isOpen = el.classList.toggle('open');

    if (isOpen) {
        // Parse ID to find fix data
        const parts = id.split('-');
        const index = parseInt(parts.pop());
        const planType = parts.join('-'); // quick-win-fixes or high-impact-fixes

        let plan;
        if (planType === 'quick-win-fixes') plan = currentResult.quickWinPlan;
        else if (planType === 'high-impact-fixes') plan = currentResult.highImpactPlan;

        if (plan && plan.fixes[index]) {
            const fix = plan.fixes[index];
            const targets = fix.applyTo || (fix.target_region_id ? [fix.target_region_id] : []);
            if (targets.length > 0) highlightRegions(targets);
            else clearHighlights();
        }
    } else {
        clearHighlights();
    }
}



/* --- RENDER LOGIC --- */

/* --- RENDER ORCHESTRATION --- */

function renderResult(result) {
    if (!result) return;
    currentResult = result; // Store global

    els.scoreRing.style.setProperty("--percent", result.score);
    els.scoreRing.style.setProperty("--color", result.scoreColor);
    els.scoreValue.textContent = result.score;
    els.scoreValue.style.color = result.scoreColor;
    els.scoreText.textContent = `${result.score} / 100`;
    els.scoreText.style.color = result.scoreColor;

    // Verdict
    if (els.verdictText) els.verdictText.textContent = result.verdict;

    // Blockers (Weakest)
    if (els.weakestText) els.weakestText.textContent = result.blockers.join(", ");

    // Metrics - Render with interaction
    if (!result.metrics || result.metrics.length === 0) {
        els.metricsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; opacity: 0.5;">No metrics available for this analysis.</div>`;
    } else {
        els.metricsGrid.innerHTML = result.metrics
            .map(m => {
                const pct = m.max ? Math.round((m.val / m.max) * 100) : m.val;
                // Escape quotes for safety
                const safeWhy = (m.why || "").replace(/"/g, "&quot;");
                return `
      <div class="metric-card" onclick="showMetricWhy(this)" style="cursor: pointer;" data-why="${safeWhy}" data-label="${m.label}">
        <div class="metric-ring" style="--percent:${pct}; --color:${m.color}">
          <div class="metric-score">${m.val}</div>
        </div>
        <div class="metric-label">${m.label}</div>
      </div>
    `;
            }).join("");

        // Inject Explanation Box if missing
        let explainBox = document.getElementById('metric-explanation');
        if (!explainBox) {
            explainBox = document.createElement('div');
            explainBox.id = 'metric-explanation';
            // Inline styles for quick injection, matches theme
            explainBox.style.cssText = `
            display: none;
            margin-top: 8px; /* Reduced from 15px */
            padding: 16px;
            background: rgba(255,255,255,0.03);
            border: 1px solid var(--border-subtle);
            border-radius: 12px;
            font-size: 0.9rem;
            color: rgba(255,255,255,0.9);
            line-height: 1.5;
            animation: fadeIn 0.3s ease;
        `;
            // Insert after grid
            els.metricsGrid.parentNode.insertBefore(explainBox, els.metricsGrid.nextSibling);

            // Add fadeIn animation style
            if (!document.getElementById('anim-style-fade')) {
                const style = document.createElement('style');
                style.id = 'anim-style-fade';
                style.innerHTML = `@keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }`;
                document.head.appendChild(style);
            }
        }

        // Reset box state on new render
        explainBox.style.display = 'none';
        explainBox.innerHTML = '';
        explainBox.dataset.activeLabel = ''; // Track active card

        // Global function to handle click (attached to window for HTML access)
        window.showMetricWhy = function (card) {
            const why = card.dataset.why;
            const label = card.dataset.label;
            const box = document.getElementById('metric-explanation');

            // TOGGLE LOGIC
            // If clicking the same card that is currently active
            // 1. Hide box
            // 2. Remove highlight
            // 3. Reset internal tracker
            if (box.dataset.activeLabel === label && box.style.display === 'block') {
                box.style.display = 'none';
                box.dataset.activeLabel = '';
                card.style.borderColor = 'var(--border-subtle)';
                card.style.background = 'var(--bg-card)';
                return;
            }

            // Reset all cards first
            document.querySelectorAll('.metric-card').forEach(c => {
                c.style.borderColor = 'var(--border-subtle)';
                c.style.background = 'var(--bg-card)';
            });

            // Activate new card
            card.style.borderColor = 'var(--color-primary)';
            card.style.background = 'var(--bg-card-hover)';

            // Show box with new content
            if (box) {
                box.style.display = 'block';
                box.dataset.activeLabel = label;
                box.innerHTML = `<strong style="color:var(--color-primary); display:block; margin-bottom:4px;">${label} Analysis</strong>${why}`;
            }
        };

        // Render Plans
        renderPlan('quick-win-fixes', result.quickWinPlan);
        renderPlan('high-impact-fixes', result.highImpactPlan);

        // Note handling
        const noteEl = document.getElementById('high-impact-note');
        if (noteEl) {
            if (result.highImpactPlan && result.highImpactPlan.note) {
                noteEl.style.display = 'block';
                noteEl.textContent = result.highImpactPlan.note;
            } else {
                noteEl.style.display = 'none';
            }
        }


    }
}

function copyText(text) {
    navigator.clipboard.writeText(text).then(showToast);
}

function showToast() {
    els.toast.classList.add("show");
    setTimeout(() => els.toast.classList.remove("show"), 1500);
}

/* --- COPY LOGIC --- */

// Setup delegation once
document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !currentResult) return;

    const action = btn.dataset.action;
    if (action === 'copy-plan-quick') {
        const text = currentResult.quickWinPlan.fixes
            .map(f => `${f.priority} (${f.pts}): ${f.measurableFix}`).join('\n');
        copyText(text);
    } else if (action === 'copy-plan-high') {
        const text = currentResult.highImpactPlan.fixes
            .map(f => `${f.priority} (${f.pts}): ${f.measurableFix}`).join('\n');
        copyText(text);
    } else if (action === 'copy-layouts') {
        const text = currentResult.layoutOptions
            .map(l => `${l.label}:\n${l.steps.map(s => `- ${s}`).join('\n')}`).join('\n\n');
        copyText(text);
    } else if (action === 'copy-summary') {
        const lines = [
            `Thumbnail Analysis: ${currentResult.score}/100 - ${currentResult.verdict}`,
            `Blockers: ${currentResult.blockers.join(', ')}`,
            `\nQuick Win Plan (${currentResult.quickWinPlan.time}):`,
            currentResult.quickWinPlan.fixes.map(f => `- ${f.priority}: ${f.measurableFix}`).join('\n'),
            `\nHigh Impact Plan (${currentResult.highImpactPlan.time}):`,
            currentResult.highImpactPlan.fixes.map(f => `- ${f.priority}: ${f.measurableFix}`).join('\n'),
            `\nLayout Options:`,
            currentResult.layoutOptions.map(l => `[${l.label}] ${l.steps.join('; ')}`).join('\n')
        ];
        copyText(lines.join('\n'));
    }
});

/* --- UPDATED TAB SWITCHING --- */
els.tabs.forEach((btn) => {
    btn.addEventListener("click", async () => {
        const group = btn.dataset.group;

        if (group === "preview") {
            // Handle Preview Mode (Visuals only)
            document.querySelectorAll('[data-group="preview"]').forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");

            const mode = btn.dataset.mode;
            const img = document.getElementById("main-thumbnail");

            // Reset specific mode classes
            img.classList.remove("mode-squint", "mode-mobile");

            // Apply new mode
            if (mode === "squint") img.classList.add("mode-squint");
            if (mode === "mobile") img.classList.add("mode-mobile");
        }
    });
});

// Fix accordion + copy (legacy - only if fix-list element exists)
if (els.fixList) {
    els.fixList.addEventListener("click", (e) => {
        const el = e.target.closest("[data-action]");
        if (!el) return;

        const action = el.dataset.action;
        const i = Number(el.dataset.i);
        const fix = currentResult.fixes[i];

        if (action === "copy-fix") {
            e.stopPropagation();
            copyText(`IMPACT: ${fix.impact}\n${fix.desc}`);
            return;
        }

        if (action === "toggle-fix") {
            openFixIndex = openFixIndex === i ? -1 : i;
            renderResult(currentResult);
        }
    });
}

// Copy layout (only if accordion-content element exists)
if (els.accContent) {
    els.accContent.addEventListener("click", (e) => {
        const btn = e.target.closest('[data-action="copy-layout"]');
        if (!btn) return;
        copyText(btn.dataset.text);
    });
}

// Rescan Logic - Forces fresh analysis and clears cache
const rescanBtn = document.getElementById("rescan-btn");
if (rescanBtn) {
    rescanBtn.addEventListener("click", async () => {
        rescanBtn.disabled = true;

        // Clear cache - rescan means fresh analysis
        analysisCache.fast = null;
        analysisCache.normal = null;
        analysisCache.deep = null;
        localStorage.removeItem('linter_analysis_fast');
        localStorage.removeItem('linter_analysis_normal');
        localStorage.removeItem('linter_analysis_deep');
        console.log("[CACHE] Cleared - performing fresh analysis");

        try {
            // Recompute metrics from current image state
            const metrics = computeRetinaMetrics();
            console.log("RESCAN METRICS", metrics);
            window.__latestMetrics = metrics;

            // Run analysis (shows loading overlay automatically)
            const raw = await runAnalysis(currentTab, metrics);
            analysisCache[currentTab] = raw; // Save to cache

            const normalized = normalizeResult(raw, currentTab);
            renderResult(normalized);

            updateUIWithMetrics(metrics);
        } catch (e) {
            console.error("Rescan failed:", e);
            // Error already shown by runAnalysis via loading overlay
        } finally {
            rescanBtn.disabled = false;
        }
    });
}

// Global flag: once the initial analysis has run, NEVER run it again
let _initialAnalysisDone = false;

// INIT
async function init() {
    try {
        const stored = localStorage.getItem('linter_data');
        if (stored) {
            const data = JSON.parse(stored);

            if (data.imageUrlFull || data.imageData) {
                const img = document.getElementById('main-thumbnail');
                const src = data.imageUrlFull || data.imageData;

                // Only clear localStorage cache if the IMAGE actually changed
                const currentImageHash = (data.imageUrlSmall || src).substring(0, 100);
                const savedHash = localStorage.getItem('linter_analysis_hash');
                const isNewImage = (savedHash !== currentImageHash);

                // Also check if we have the tab data cached
                const currentTabCached = !!localStorage.getItem('linter_analysis_' + (data.mode || 'fast'));
                const needsAnalysis = isNewImage || !currentTabCached;

                if (isNewImage) {
                    analysisCache.fast = null;
                    analysisCache.normal = null;
                    analysisCache.deep = null;
                    localStorage.removeItem('linter_analysis_hash');
                    localStorage.removeItem('linter_analysis_fast');
                    localStorage.removeItem('linter_analysis_normal');
                    localStorage.removeItem('linter_analysis_deep');
                    console.log("[CACHE] Cleared - NEW image detected");
                } else {
                    console.log("[CACHE] Same image detected - keeping cached results");
                }

                if (img) {
                    img.style.display = 'block';
                    const overlay = document.querySelector('.preview-overlay');
                    if (overlay) overlay.style.display = 'none';

                    if (API_CONFIG.useLiveBackend && needsAnalysis) {
                        showLoading("Analyzing thumbnail...", "Running computer vision models...");
                    }

                    img.crossOrigin = "Anonymous";

                    // ONLY render the image on load. 
                    // Never fire the analysis pipeline here automatically.
                    img.onload = () => {
                        console.log("[INIT] Image loaded. Updating UI canvases.");
                        const cvOriginal = document.getElementById("cv_original");
                        const cvMobile = document.getElementById("cv_mobile");

                        if (cvOriginal && cvMobile) {
                            try {
                                drawToCanvas(img, cvOriginal, 960, 0);
                                drawToCanvas(img, cvMobile, 360, 2);
                            } catch (e) {
                                console.warn("[INIT] Failed to draw canvases", e);
                            }
                        }

                        // Explicitly start the ONE-TIME analysis if haven't done so.
                        if (!_initialAnalysisDone) {
                            _initialAnalysisDone = true;

                            if (needsAnalysis) {
                                startAnalysisForSource(img);
                            } else {
                                console.log("[INIT] Cache hit! Rendering directly, skipping backend.");
                                const tab = data.mode || 'fast';
                                const cachedStr = localStorage.getItem('linter_analysis_' + tab);
                                if (cachedStr) {
                                    const raw = JSON.parse(cachedStr);
                                    analysisCache[tab] = raw;
                                    const metrics = computeRetinaMetrics(); // For the UI
                                    const normalized = normalizeResult(raw, tab);
                                    renderResult(normalized);
                                    updateUIWithMetrics(metrics);
                                    hideLoading();
                                } else {
                                    // Fallback
                                    startAnalysisForSource(img);
                                }
                            }
                        }
                    };

                    img.onerror = (e) => {
                        console.error("[INIT] Failed to load image", e);
                        hideLoading();
                        showAnalysisError("Failed to load saved image");
                    };

                    // Trigger the load
                    img.src = src;
                }
            }

            // Set Mode
            if (data.mode && ['fast', 'normal', 'deep'].includes(data.mode)) {
                currentTab = data.mode;
            }
        }
    } catch (e) {
        console.error("Failed to load local data", e);
    }
}

// Dedicated function that ONLY analyzes the source image.
async function startAnalysisForSource(img) {
    console.log("[ANALYSIS] Starting explicitly for source image");
    try {
        const metrics = computeRetinaMetrics();
        console.log("RETINA METRICS", metrics);
        window.__latestMetrics = metrics;

        // runAnalysis actually checks localStorage internally so this is safe
        const raw = await runAnalysis(currentTab, metrics);
        analysisCache[currentTab] = raw;

        const normalized = normalizeResult(raw, currentTab);
        renderResult(normalized);
        updateUIWithMetrics(metrics);
    } catch (e) {
        console.warn("[ANALYSIS] Pipeline failed:", e);
        hideLoading();
        showAnalysisError("Analysis failed to start. Is the backend running?");
    }
}

function updateUIWithMetrics(metrics) {
    const verdictText = document.getElementById("verdict-text");
    const mobilePass = metrics.mobile.pass;
    const badgeHtml = mobilePass
        ? `<span class="badge-pass" style="color:#4ade80; font-weight:700; font-size:0.8rem; margin-left:8px; background:rgba(74, 222, 128, 0.1); padding:2px 6px; border-radius:4px;">Mobile: PASS ✅</span>`
        : `<span class="badge-fail" style="color:#f87171; font-weight:700; font-size:0.8rem; margin-left:8px; background:rgba(248, 113, 113, 0.1); padding:2px 6px; border-radius:4px;">Mobile: FAIL ❌</span>`;

    if (verdictText) {
        // Append badge safely
        const existingBadge = verdictText.querySelector('.badge-pass, .badge-fail');
        if (existingBadge) existingBadge.remove();
        verdictText.insertAdjacentHTML('beforeend', badgeHtml);
    }

    // Technical Details Drawer
    const scoreInfo = document.querySelector(".score-info");
    if (scoreInfo && !document.getElementById('retina-stats')) {
        const detailsHtml = `
        <details class="tech-details" style="margin-top: 16px; width: 100%; font-size: 0.75rem; color: var(--text-muted); cursor: pointer; border-top: 1px solid var(--border-subtle); padding-top: 8px;">
            <summary style="margin-bottom: 8px; font-weight: 500; opacity: 0.8;">Technical Stats</summary>
            <div id="retina-stats" style="padding: 10px; background: rgba(0,0,0,0.2); border-radius: 8px; display: flex; flex-direction: column; gap: 4px;">
                <!-- Injected via JS -->
            </div>
        </details>`;
        scoreInfo.insertAdjacentHTML('beforeend', detailsHtml);
    }

    const statsEl = document.getElementById("retina-stats");
    if (statsEl) {
        statsEl.innerHTML = `
            <div style="display:flex; justify-content:space-between;">
                <span>Brightness (Luma):</span>
                <span style="color:#fff; font-family:monospace;">${Math.round(metrics.brightness)}</span>
            </div>
            <div style="display:flex; justify-content:space-between;">
                <span>Contrast (StdDev):</span>
                <span style="color:#fff; font-family:monospace;">${Math.round(metrics.contrastStd)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-top:4px; pt-1; border-top:1px dashed rgba(255,255,255,0.1);">
                <span>Mobile DynRange:</span>
                <span style="font-family:monospace; color:${metrics.mobile.dynRange < 35 ? '#f87171' : '#4ade80'}">${Math.round(metrics.mobile.dynRange)}</span>
            </div>
            <div style="display:flex; justify-content:space-between;">
                <span>Mobile EdgeDensity:</span>
                <span style="font-family:monospace; color:${metrics.mobile.edgeDensity < 0.015 ? '#f87171' : '#4ade80'}">${(metrics.mobile.edgeDensity * 100).toFixed(2)}%</span>
            </div>
        `;
    }
}


/* --- Retina Metrics Helpers --- */

function drawToCanvas(img, canvas, targetW, blurPx = 0) {
    const ctx = canvas.getContext("2d");
    const scale = targetW / img.width;
    const w = targetW;
    const h = Math.round(img.height * scale);

    canvas.width = w;
    canvas.height = h;

    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Blur simulation for squint/mobile test
    if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;
    ctx.drawImage(img, 0, 0, w, h);
    ctx.filter = "none";
}

function lumaStats(imageData) {
    const d = imageData.data;
    const n = d.length / 4;
    const l = new Float32Array(n);

    let sum = 0;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        l[j] = y;
        sum += y;
    }

    const mean = sum / n;

    // std dev
    let varSum = 0;
    for (let i = 0; i < n; i++) {
        const diff = l[i] - mean;
        varSum += diff * diff;
    }
    const std = Math.sqrt(varSum / n);

    // dynamic range p95 - p05
    const sorted = Array.from(l).sort((a, b) => a - b);
    const p05 = sorted[Math.floor(n * 0.05)];
    const p95 = sorted[Math.floor(n * 0.95)];
    const dynRange = p95 - p05;

    return { meanLuma: mean, stdLuma: std, dynRange };
}

function edgeDensitySobel(imageData) {
    const { width: w, height: h, data: d } = imageData;

    // grayscale
    const gray = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const r = d[i], g = d[i + 1], b = d[i + 2];
            gray[y * w + x] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
    }

    // sobel kernels
    const gxK = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const gyK = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

    let edges = 0;
    let total = 0;

    // threshold tuned for 360px mobile proxy
    const TH = 80;

    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let gx = 0, gy = 0;
            let k = 0;
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const val = gray[(y + ky) * w + (x + kx)];
                    gx += val * gxK[k];
                    gy += val * gyK[k];
                    k++;
                }
            }
            const mag = Math.sqrt(gx * gx + gy * gy);
            total++;
            if (mag > TH) edges++;
        }
    }

    return edges / total; // 0..1
}

function computeRetinaMetrics() {
    const cOrig = document.getElementById("cv_original");
    const cMob = document.getElementById("cv_mobile");

    const ctxO = cOrig.getContext("2d");
    const ctxM = cMob.getContext("2d");

    const imgO = ctxO.getImageData(0, 0, cOrig.width, cOrig.height);
    const imgM = ctxM.getImageData(0, 0, cMob.width, cMob.height);

    const orig = lumaStats(imgO);
    const mob = lumaStats(imgM);

    const mobEdge = edgeDensitySobel(imgM);

    // Mobile Death Test v1 thresholds (tune later)
    const mobilePass = !(mob.dynRange < 35 || mobEdge < 0.015);

    return {
        brightness: orig.meanLuma,
        contrastStd: orig.stdLuma,
        dynRange: orig.dynRange,
        mobile: {
            width: cMob.width,
            dynRange: mob.dynRange,
            edgeDensity: mobEdge,
            pass: mobilePass
        }
    };
}



function analyzeLocal(mode, metrics) {
    let result = {};

    // 1. Get Game Config
    let game = "gta";
    try {
        const stored = localStorage.getItem("linter_data");
        if (stored) {
            const data = JSON.parse(stored);
            if (data.game) game = data.game;
        }
    } catch (e) { }

    // 2. Select Demo Data
    let key = `${game}_${mode}`;
    let demo = DEMO_RESULTS[key];

    if (!demo) {
        // Fallback to Genre Mapping
        const genreMap = {
            // Shooters
            "cod": "shooter", "warzone": "shooter", "mw3": "shooter",
            "val": "shooter", "valorant": "shooter",
            "cs2": "shooter", "counterstrike": "shooter",
            "ow2": "shooter", "overwatch": "shooter",
            "apex": "shooter", "apexlegends": "shooter",
            "r6": "shooter", "rainbowsix": "shooter", "siege": "shooter",
            "pubg": "shooter",
            "freefire": "shooter",

            // MOBA
            "lol": "moba", "league": "moba",
            "dota": "moba", "dota2": "moba",
            "mlbb": "moba", "mobilelegends": "moba",
            "brawl": "moba", "brawlstars": "moba",
            "clash": "moba", "clashroyale": "moba", // Strategy/MOBA hybrid

            // Sports/Racing
            "rl": "sports", "rocketleague": "sports",
            "eafc": "sports", "fifa": "sports",

            // RPG/General
            "genshin": "rpg", "genshinimpact": "rpg",
            "fivem": "gta", // Map back to GTA
            "gta5": "gta",
            "amongus": "trend", // Among Us fits Trend/General
            "minecraft": "minecraft",
            "roblox": "roblox",
            "fortnite": "fortnite"
        };

        // Normalize game input
        const cleanGame = game.toLowerCase().replace(/\s+/g, '');
        const genre = genreMap[cleanGame] || "trend"; // Default to Trend for unknowns

        key = `${genre}_${mode}`;
        demo = DEMO_RESULTS[key] || DEMO_RESULTS["gta_normal"]; // Ultimate fallback
    }

    // Deep copy to avoid mutating the master CONST
    result = JSON.parse(JSON.stringify(demo));
    result.mode = mode; // ensure consistency

    // DYNAMIC INJECTION: If Mobile Test Failed, inject a critical fix
    if (metrics && metrics.mobile && !metrics.mobile.pass) {
        if (!result.quickWinPlan) result.quickWinPlan = { time: "10-25 min", fixes: [] };

        // Add to top of fixes
        result.quickWinPlan.fixes.unshift({
            priority: "P1",
            pts: "+12",
            title: "Safe Area Fail",
            measurableFix: "The edge density is too low. Increase contrast or zoom in (+30%) on the subject."
        });

        // Ensure max length 5
        if (result.quickWinPlan.fixes.length > 5) {
            result.quickWinPlan.fixes.pop();
        }

        // Penalize score
        result.score = Math.max(0, result.score - 15);
        if (result.score <= 50) result.scoreColor = "#ff3b3b";
        else if (result.score <= 75) result.scoreColor = "#fbbf24";

        // Update blockers list
        if (!result.blockers) result.blockers = [];
        if (!result.blockers.includes("MOBILE") && !result.blockers.includes("VISIBILITY")) {
            result.blockers.unshift("VISIBILITY");
            // Maintain max 2
            if (result.blockers.length > 2) result.blockers.pop();
        }
    }

    return result;
}

init();

// --- PREVIEW MODE LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
    const previewTabs = document.querySelectorAll('.tab-btn[data-group="preview"]');
    const card = document.querySelector('.thumbnail-card');
    const badge = document.querySelector('.mobile-status-badge');

    if (!card || !previewTabs.length) return;

    previewTabs.forEach(btn => {
        btn.addEventListener('click', () => {
            // 1. Toggle Active State
            previewTabs.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // 2. Set Mode Classes
            const mode = btn.dataset.mode;
            card.classList.remove('mode-squint', 'mode-mobile', 'mobile-pass', 'mobile-fail');

            if (mode === 'squint') {
                card.classList.add('mode-squint');
            } else if (mode === 'mobile') {
                card.classList.add('mode-mobile');
                updateMobileBadge();
            }
        });
    });

    function updateMobileBadge() {
        if (!currentResult || !badge) return;

        // Determine Pass/Fail from badges or metrics
        let passed = false;

        if (currentResult.badges && currentResult.badges.mobile) {
            passed = currentResult.badges.mobile === 'PASS';
        } else {
            // Fallback if badges missing
            const score = currentResult.score || 0;
            passed = score >= 70;
        }

        // Update UI
        badge.textContent = `MOBILE: ${passed ? 'PASS' : 'FAIL'}`;

        // Add class to card (for ring) and badge logic
        card.classList.remove('mobile-pass', 'mobile-fail');
        card.classList.add(passed ? 'mobile-pass' : 'mobile-fail');
    }
});

/* --- FOCUS MODE LOGIC --- */
function toggleFocusMode() {
    const container = document.querySelector('.dashboard-container');
    const btn = document.getElementById('focus-toggle-btn');

    if (!container || !btn) return;

    // Toggle Class
    container.classList.toggle('focus-mode');

    // Check State
    const isFocus = container.classList.contains('focus-mode');

    // Update Button State
    if (isFocus) {
        btn.classList.add('focus-active');
        btn.title = 'Back to Analysis View';
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 14 10 14 10 20"></polyline>
            <polyline points="20 10 14 10 14 4"></polyline>
            <line x1="14" y1="10" x2="21" y2="3"></line>
            <line x1="3" y1="21" x2="10" y2="14"></line>
        </svg>`;
    } else {
        btn.classList.remove('focus-active');
        btn.title = 'Focus View';
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 3 21 3 21 9"></polyline>
            <polyline points="9 21 3 21 3 15"></polyline>
            <line x1="21" y1="3" x2="14" y2="10"></line>
            <line x1="3" y1="21" x2="10" y2="14"></line>
        </svg>`;
    }
}

/* --- DATA NORMALIZATION --- */
function normalizeAnalysisResult(raw) {
    if (!raw) return null;

    // 1. Separate _meta 
    const { _meta, ...core } = raw || {};

    // 2. Initialize Canonical Object with defaults
    const normalized = {
        _meta,
        score: 0,
        scoreColor: "#ff3b3b", // Default to red
        verdict: "Analysis Incomplete",
        fixes: [],
        highImpactPlan: { fixes: [] }, // Mapped from layoutOptions
        topProblems: [],
        blockers: [],
        metrics: []
    };

    // 3. Extract Score & core fields
    if (typeof core.score === 'number') {
        normalized.score = core.score;
    } else if (core.rating && typeof core.rating.total === 'number') {
        normalized.score = core.rating.total;
    }

    // 4. Ensure Arrays
    if (Array.isArray(core.fixes)) normalized.fixes = core.fixes;
    if (Array.isArray(core.topProblems)) normalized.topProblems = core.topProblems;

    // 5. Map Blockers
    if (core.rating && Array.isArray(core.rating.focus)) {
        normalized.blockers = core.rating.focus;
    } else if (Array.isArray(core.blockers)) {
        normalized.blockers = core.blockers;
    } else if (Array.isArray(core.weakest)) {
        normalized.blockers = core.weakest;
    }

    // 6. Map Layout Options to High Impact Plan
    const rawLayouts = Array.isArray(core.layoutOptions) ? core.layoutOptions :
        (Array.isArray(core.comps) ? core.comps : []);

    if (rawLayouts.length > 0) {
        normalized.highImpactPlan = {
            time: "",
            fixes: rawLayouts.map((lo, i) => {
                const letter = String.fromCharCode(65 + i); // 0 -> A, 1 -> B, 2 -> C
                return {
                    priority: `Option ${letter}`,
                    title: lo.title || lo.label || `Layout ${letter}`,
                    goal: lo.desc || lo.goal || "",
                    moves: lo.moves || [],
                    detail: Array.isArray(lo.moves) ? lo.moves.join("; ") : (lo.moves || ""),
                    measurableFix: lo.goal || "No goal provided",
                    applyTo: []
                };
            })
        };
    }

    // 7. Map Metrics
    if (core.rating) {
        const metricKeys = ['POP', 'CLARITY', 'HOOK', 'CLEAN', 'TRUST'];
        normalized.metrics = metricKeys.map(key => {
            const m = core.rating[key] || { val: 0, why: '' };
            const val = typeof m.val === 'number' ? m.val : 0;
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
        normalized.metrics = core.metrics;
    }

    // 8. Derive Score Props
    if (normalized.score >= 80) normalized.scoreColor = "#4ade80";
    else if (normalized.score >= 60) normalized.scoreColor = "#fbbf24";

    if (core.verdict) {
        normalized.verdict = core.verdict;
    } else {
        if (normalized.score > 0 || core.rating) {
            normalized.verdict = normalized.score >= 90 ? "Excellent" :
                normalized.score >= 75 ? "Good" :
                    normalized.score >= 50 ? "Needs Work" : "Critical Fixes Needed";
        }
    }

    return normalized;
}

/* ============================================================
   FIX GENERATOR: State Machine + Variant Management
   ============================================================ */

// Variant State
const variantState = {
    original: null,       // Original image URL (set on first analysis)
    variants: [],         // Array of { id, imageUrl, fixTitle, generatedAt }
    activeId: 'original' // Currently selected variant
};

// Initialize original image into variant state when analysis loads
function initVariantOriginal() {
    const img = document.getElementById('main-thumbnail');
    if (img && img.src) {
        variantState.original = img.src;
        const origThumb = document.getElementById('thumb-orig');
        if (origThumb) origThumb.src = img.src;
    }
}

// Add a new variant to the strip
function addVariant(imageUrl, fixTitle) {
    const id = `v${variantState.variants.length + 1} `;
    variantState.variants.push({ id, imageUrl, fixTitle, generatedAt: Date.now() });

    const strip = document.getElementById('variants-strip');
    if (!strip) return id;

    const item = document.createElement('div');
    item.className = 'variant-item';
    item.dataset.id = id;
    item.onclick = () => selectVariant(id);
    item.innerHTML = `
        <img src="${imageUrl}" alt="${fixTitle}" class="variant-thumb">
        <span class="variant-label">${id.toUpperCase()}</span>
    `;
    strip.appendChild(item);

    // Auto-select the new variant
    selectVariant(id);
    return id;
}

// Select a variant from the strip
function selectVariant(id) {
    variantState.activeId = id;

    // Update strip UI
    document.querySelectorAll('.variant-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === id);
    });

    // Update main preview
    const img = document.getElementById('main-thumbnail');
    if (!img) return;

    // CRITICAL UPDATE: Ensure no lingering onload handlers fire when we swap the source!
    img.onload = null;

    if (id === 'original') {
        img.src = variantState.original;
    } else {
        const variant = variantState.variants.find(v => v.id === id);
        if (variant) img.src = variant.imageUrl;
    }
}

// Ensure Focus Mode is ON (auto-switch from Analysis)
function ensureFocusMode() {
    const container = document.querySelector('.dashboard-container');
    if (container && !container.classList.contains('focus-mode')) {
        toggleFocusMode(); // Reuse existing toggle
    }
    // Show the prompt bar
    const promptBar = document.getElementById('focus-prompt-bar');
    if (promptBar) promptBar.style.display = 'flex';
}

/**
 * GENERATE FIX - Main State Machine
 * Called when user clicks "Generate Fix" on a fix card.
 * Flow: Button states -> /generate-prompt -> show prompt -> /generate-image -> add variant
 */
async function generateFix(uniqueId, fixIndex, containerId) {
    const btn = document.getElementById(`btn-gen-${uniqueId}`);
    const strengthSelect = document.getElementById(`strength-${uniqueId}`);
    if (!btn) return;

    // 1. Resolve the fix data from the current result
    let fix = null;
    if (containerId === 'quick-win-fixes' && currentResult?.quickWinPlan?.fixes) {
        fix = currentResult.quickWinPlan.fixes[fixIndex];
    } else if (containerId === 'high-impact-fixes' && currentResult?.highImpactPlan?.fixes) {
        fix = currentResult.highImpactPlan.fixes[fixIndex];
    }

    if (!fix) {
        console.error('[GenerateFix] Could not resolve fix data for index', fixIndex);
        return;
    }

    const strength = strengthSelect ? strengthSelect.value : 'medium';
    const originalBtnText = btn.textContent;

    // 2. Auto-switch to Focus Mode
    ensureFocusMode();

    // Initialize original if not done yet
    if (!variantState.original) initVariantOriginal();

    try {
        // === STEP A: Generate Prompt (ChatGPT) ===
        btn.textContent = 'Generating Prompt…';
        btn.disabled = true;
        btn.style.opacity = '0.7';

        const promptRes = await fetch(`${API_CONFIG.baseUrl}/generate-prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cv: currentResult?._meta?.cv || {},
                fix: {
                    title: fix.title,
                    instruction: fix.measurableFix || fix.detail,
                    priority: fix.priority
                },
                game: window.__currentGame || ''
            })
        });

        if (!promptRes.ok) {
            const err = await promptRes.json().catch(() => ({}));
            throw new Error(err.error || 'Prompt generation failed');
        }

        const promptData = await promptRes.json();
        console.log('[GenerateFix] Prompt:', promptData.prompt);

        // Show generated prompt in the Focus Mode input bar
        const promptInput = document.getElementById('focus-prompt-input');
        if (promptInput) promptInput.value = promptData.prompt;

        // === STEP B: Generate Image (Gemini) ===
        btn.textContent = 'Generating Thumbnail…';

        // Use the currently active image as the base
        const baseImage = document.getElementById('main-thumbnail')?.src || variantState.original;

        // Allow user to override prompt via the Focus bar
        const finalPrompt = promptInput ? (promptInput.value || promptData.prompt) : promptData.prompt;

        const imageRes = await fetch(`${API_CONFIG.baseUrl}/generate-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                baseImage,
                prompt: finalPrompt,
                negativePrompt: promptData.negativePrompt || '',
                strength
            })
        });

        if (!imageRes.ok) {
            const err = await imageRes.json().catch(() => ({}));
            throw new Error(err.error || 'Image generation failed');
        }

        const imageData = await imageRes.json();

        // === STEP C: Success - Add Variant ===
        addVariant(imageData.imageUrl, fix.title);

        btn.textContent = 'Fix Ready ✓';
        btn.style.background = 'var(--color-success)';
        btn.style.boxShadow = '0 0 10px rgba(45, 212, 191, 0.4)';

        // Reset button after 3s
        setTimeout(() => {
            btn.textContent = originalBtnText;
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.background = 'var(--color-primary)';
            btn.style.boxShadow = '0 0 10px rgba(59, 130, 246, 0.4)';
        }, 3000);

    } catch (err) {
        // === FAIL STATE ===
        console.error('[GenerateFix] Failed:', err.message);
        btn.textContent = 'Failed — Try Again';
        btn.style.background = 'var(--color-danger)';
        btn.style.boxShadow = '0 0 10px rgba(248, 113, 113, 0.4)';
        btn.disabled = false;
        btn.style.opacity = '1';

        // Reset after 3s
        setTimeout(() => {
            btn.textContent = originalBtnText;
            btn.style.background = 'var(--color-primary)';
            btn.style.boxShadow = '0 0 10px rgba(59, 130, 246, 0.4)';
        }, 3000);
    }
}


/**
 * GENERATE CUSTOM - Focus Mode Prompt Box
 * Called when user clicks "Generate" via the global prompt bar.
 */
async function generateFromFocusBox() {
    const btn = document.getElementById('focus-generate-btn');
    const input = document.getElementById('focus-prompt-input');
    const modelSelect = document.getElementById('focus-model-select');

    if (!btn || !input) return;

    const rawPrompt = input.value.trim();
    if (!rawPrompt) {
        input.placeholder = "Please enter a prompt first...";
        setTimeout(() => input.placeholder = "Add or remove things in the image...", 2000);
        return;
    }

    const strength = modelSelect ? modelSelect.value : 'high';
    const originalBtnText = btn.innerHTML; // Contains the SVG

    // Determine the base image
    const activeImage = document.getElementById('main-thumbnail')?.src || variantState.original;
    if (!activeImage) {
        console.error('[GenerateCustom] No active image found to use as base.');
        return;
    }

    try {
        btn.innerHTML = 'Generating...<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>';
        btn.disabled = true;
        btn.style.opacity = '0.7';

        // Note: For pure manual prompting, we skip the /generate-prompt (GPT) phase 
        // and go straight to image generation as the user provided the literal prompt.
        const imageRes = await fetch(`${API_CONFIG.baseUrl}/generate-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                baseImage: activeImage,
                prompt: rawPrompt,
                negativePrompt: '',
                strength,
                referenceImage: window.__referenceImage || null
            })
        });

        if (!imageRes.ok) {
            const err = await imageRes.json().catch(() => ({}));
            throw new Error(err.error || 'Image generation failed');
        }

        const imageData = await imageRes.json();

        // Add Variant to strip
        addVariant(imageData.imageUrl, "Custom Prompt");

        btn.innerHTML = 'Done ✓';
        btn.style.background = 'var(--color-success)';

        setTimeout(() => {
            btn.innerHTML = originalBtnText;
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.background = ''; // reset to default CSS
            input.value = ''; // clear input
        }, 3000);

    } catch (err) {
        console.error('[GenerateCustom] Failed:', err.message);
        btn.innerHTML = 'Failed';
        btn.style.background = 'var(--color-danger)';

        setTimeout(() => {
            btn.innerHTML = originalBtnText;
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.background = '';
        }, 3000);
    }
}

// Wire variant strip clicks (delegate)
document.addEventListener('DOMContentLoaded', () => {
    // Bind Focus Mode Generate Button
    const focusGenBtn = document.getElementById('focus-generate-btn');
    if (focusGenBtn) {
        focusGenBtn.addEventListener('click', generateFromFocusBox);
    }

    // Bind Add Image Button → opens file picker
    const addImageBtn = document.getElementById('focus-add-image-btn');
    const addImageInput = document.getElementById('focus-add-image-input');
    if (addImageBtn && addImageInput) {
        addImageBtn.addEventListener('click', () => addImageInput.click());
        addImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                window.__referenceImage = ev.target.result; // base64 data URL
                addImageBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                    ${file.name.substring(0, 15)}…`;
                addImageBtn.style.color = 'var(--color-success, #22c55e)';
                console.log(`[AddImage] Loaded reference: ${file.name} (${(file.size / 1024).toFixed(0)} KB)`);
            };
            reader.readAsDataURL(file);
        });
    }

    const strip = document.getElementById('variants-strip');
    if (strip) {
        strip.addEventListener('click', (e) => {
            const item = e.target.closest('.variant-item');
            if (item && item.dataset.id) {
                selectVariant(item.dataset.id);
            }
        });
    }

    // Show/hide prompt bar with Focus Mode
    const focusBtn = document.getElementById('focus-toggle-btn');
    if (focusBtn) {
        const origToggle = focusBtn.onclick;
        focusBtn.onclick = () => {
            if (origToggle) origToggle();
            else toggleFocusMode();

            const isFocus = document.querySelector('.dashboard-container')?.classList.contains('focus-mode');
            const promptBar = document.getElementById('focus-prompt-bar');
            if (promptBar) promptBar.style.display = isFocus ? 'flex' : 'none';
        };
    }
});

