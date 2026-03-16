let currentResult = null; // Holds the normalized result object
let openFixIndex = 0;
let currentTab = "normal";

// --- ANALYSIS CACHE ---
const analysisCache = {
    fast: null,
    normal: null,
    deep: null
};

// --- API CONFIGURATION ---
const API_CONFIG = {
    baseUrl: window.location.hostname === 'localhost' ? "http://localhost:8787" : "",
    useLiveBackend: true 
};

const PRO_PLANS = new Set(['pro', 'premium', 'paid']);
let currentUserPlan = 'free';

function normalizeUserPlan(plan) {
    if (!plan || typeof plan !== 'string') return 'free';
    const normalized = plan.trim().toLowerCase();
    if (!normalized || normalized === '...') return 'free';
    return normalized;
}

function isProUser() {
    const plan = normalizeUserPlan(currentUserPlan || window.__userPlan || 'free');
    return PRO_PLANS.has(plan);
}

function enforceHighAccess(selectEl) {
    if (!selectEl) return true;
    if (selectEl.value === 'high' && !isProUser()) {
        selectEl.value = 'low';
        window.location.href = 'pro-request.html';
        return false;
    }
    return true;
}

function syncStrengthSelectAccess(selectEl) {
    if (!selectEl) return;
    const highOption = selectEl.querySelector('option[value="high"]');
    if (!highOption) return;

    if (isProUser()) {
        highOption.disabled = false;
        highOption.textContent = 'High (Best)';
        return;
    }

    highOption.disabled = true;
    highOption.textContent = 'Locked: High (Best)';
    if (selectEl.value === 'high') {
        selectEl.value = 'low';
    }
}

function applyPlanAccessGates() {
    document.querySelectorAll('select.strength-select, #focus-model-select').forEach(syncStrengthSelectAccess);
}

function setUserPlan(plan) {
    currentUserPlan = normalizeUserPlan(plan);
    window.__userPlan = currentUserPlan;
    applyPlanAccessGates();
}

window.setUserPlan = setUserPlan;
window.handleStrengthChange = enforceHighAccess;

window.addEventListener('user-plan-updated', (event) => {
    const plan = event?.detail?.plan || 'free';
    setUserPlan(plan);
});

async function fetchBackendAnalysis(payload) {
    const url = `${API_CONFIG.baseUrl}/analyze`;
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
        if (data.layouts && !data.comps) {
            data.comps = data.layouts;
        } else if (data.layoutOptions && !data.comps) {
            data.comps = data.layoutOptions.map((lo, i) => ({
                label: lo.label || (i === 0 ? "A" : "B"),
                title: lo.name,
                desc: lo.goal,
                moves: lo.moves || []
            }));
        }

        if (data.rating) {
            data.score = data.rating.total;
            data.scoreColor = data.score >= 80 ? "#4ade80" : data.score >= 60 ? "#fbbf24" : "#ff3b3b";
            data.verdict = data.score >= 90 ? "Excellent" : data.score >= 75 ? "Good" : data.score >= 50 ? "Needs Work" : "Critical Fixes Needed";
            data.blockers = data.rating.focus || [];
            const metricKeys = ['POP', 'CLARITY', 'HOOK', 'CLEAN', 'TRUST'];
            data.metrics = metricKeys.map(key => {
                const m = data.rating[key] || { val: 0, why: '' };
                const val = m.val || 0;
                const color = val >= 15 ? "#4ade80" : val >= 10 ? "#fbbf24" : "#ff3b3b";
                return { label: key, val, max: 20, color, why: m.why || "No details provided." };
            });
        }
        return data;
    } catch (error) {
        throw error;
    }
}

function buildApiPayload(mode, metrics) {
    let payload = { mode, analyzeMode: mode };
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
    } catch (e) {}
    return payload;
}

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
        setTimeout(() => hideLoading(), 4000);
    }
}

async function runAnalysis(mode, metrics) {
    if (!API_CONFIG.useLiveBackend) return analyzeLocal(mode, metrics);
    showLoading("🔍 Analyzing thumbnail...", "Connecting to AI backend");
    try {
        const payload = buildApiPayload(mode, metrics);
        if (!payload.imageUrlSmall) throw new Error("No image uploaded.");
        const imageHash = payload.imageUrlSmall.substring(0, 100);
        showLoading("✨ Processing Analysis...", "Evaluating composition and structure");
        const result = await fetchBackendAnalysis(payload);
        if (!result || (!result.rating && !result.metrics && (!result.fixes || result.fixes.length === 0))) {
            throw new Error("Analysis failed: Incomplete response.");
        }
        localStorage.setItem('linter_analysis_hash', imageHash);
        localStorage.setItem('linter_analysis_' + mode, JSON.stringify(result));
        hideLoading();
        return result;
    } catch (error) {
        showLoadingError(error.message);
        throw error;
    }
}

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

function normalizeResult(raw, mode) {
    const res = { ...raw, mode };
    if (Array.isArray(raw.topProblems)) res.topProblems = raw.topProblems;
    if (raw.rating) {
        res.score = raw.rating.total || 0;
        res.scoreColor = res.score >= 80 ? "#4ade80" : res.score >= 60 ? "#fbbf24" : "#ff3b3b";
        res.verdict = res.score >= 80 ? "PUBLISH" : "FIX then publish";
        const bucketKeys = ['POP', 'CLARITY', 'HOOK', 'CLEAN', 'TRUST'];
        res.metrics = bucketKeys.map(key => {
            const item = raw.rating[key] || { val: 0 };
            const val = item.val || 0;
            const color = val >= 15 ? "#4ade80" : val >= 10 ? "#fbbf24" : "#ff3b3b";
            return { label: key, val, max: 20, color, why: item.why || "No explanation available." };
        });
    }
    if (raw.weaknessRanking) res.blockers = raw.weaknessRanking.map(w => w.area).slice(0, 2);
    if (!res.blockers || res.blockers.length === 0) res.blockers = ["None", "None"];
    const mappedFixes = (raw.fixes || []).map(f => ({
        priority: f.priority || "P1",
        pts: f.pts || "+5",
        title: f.title,
        measurableFix: f.instruction || f.why,
        detail: f.why,
        applyTo: f.applyTo
    }));
    res.quickWinPlan = { time: "10-25 min", fixes: mappedFixes.slice(0, 5) };
    if (raw.layoutOptions && Array.isArray(raw.layoutOptions) && raw.layoutOptions.length >= 2) {
        res.highImpactPlan = {
            time: "",
            fixes: raw.layoutOptions.map((l, i) => {
                const letter = String.fromCharCode(65 + i);
                return {
                    priority: `Option ${letter}`,
                    pts: "",
                    title: l.title || l.label || `Layout ${letter}`,
                    goal: l.goal,
                    moves: l.moves,
                    measurableFix: l.goal || "No goal provided",
                    detail: Array.isArray(l.moves) ? l.moves.join("; ") : (l.moves || ""),
                    applyTo: []
                };
            })
        };
    } else {
        res.highImpactPlan = { fixes: [] };
    }
    return res;
}

function analyzeLocalOld(mode, metrics) {
    const isFinished = mode === 'finished';
    let result = isFinished ? {
        score: 93, scoreColor: "#4ade80", verdict: "Excellent", weakest: ["None"],
        metrics: [
            { label: "POP", val: 19, max: 20, color: "#4ade80" },
            { label: "CLARITY", val: 18, max: 20, color: "#4ade80" },
            { label: "HOOK", val: 17, max: 20, color: "#4ade80" },
            { label: "CLEAN", val: 20, max: 20, color: "#4ade80" },
            { label: "TRUST", val: 19, max: 20, color: "#4ade80" },
        ],
        fixes: [
            { priority: "LOW", title: "Optimized Images", detail: "Images are compressed.", measurableFix: "Ensure all images are served in WEBP format." },
            { priority: "MED", title: "Color Contrast", detail: "Some elements have low contrast.", measurableFix: "Increase contrast ratios." }
        ],
        comps: [{ label: "A", title: "Standard Grid", desc: "Clean 3-column layout" }]
    } : {
        score: 43, scoreColor: "#ff3b3b", verdict: "Needs Work", weakest: ["CLARITY"],
        metrics: [
            { label: "CLARITY", val: 10, max: 25, color: "#ff3b3b" },
            { label: "HOOK", val: 8, max: 25, color: "#ff3b3b" }
        ],
        fixes: [{ priority: "HIGH", title: "Fix Alignment", detail: "Navigation is off.", measurableFix: "Align nav items significantly to the right." }],
        comps: [{ label: "A", title: "Sidebar Layout", desc: "Vertical nav" }]
    };
    if (metrics && metrics.mobile && !metrics.mobile.pass) {
        result.fixes.unshift({ priority: "CRITICAL", title: "Safe Area Fail", detail: "Detail lost when scaled.", measurableFix: "Increase contrast." });
        result.score = Math.max(0, result.score - 15);
    }
    return result;
}

function renderPlan(containerId, planData) {
    const container = document.getElementById(containerId);
    if (!container || !planData || !planData.fixes) {
        if (container) container.innerHTML = `<div class="p-4 text-white/50 text-sm">No plan data available</div>`;
        return;
    }
    container.innerHTML = planData.fixes.map((fix, i) => {
        const pClass = (fix.priority || 'MED').toLowerCase().replace(" ", "");
        const uniqueId = `${containerId}-${i}`;
        const isLayout = Array.isArray(fix.moves) || typeof fix.moves === 'string';
        let mainContentHtml = '';
        let buttonText = 'Generate Fix';
        if (isLayout) {
            const goalHtml = fix.goal ? `<div class="layout-goal">${fix.goal}</div>` : '';
            let movesList = Array.isArray(fix.moves) ? fix.moves : [fix.moves].filter(Boolean);
            const movesHtml = movesList.length > 0 ? `<ol class="layout-moves-list">${movesList.map(m => `<li>${m}</li>`).join('')}</ol>` : '<div class="text-white/50 text-sm">No steps provided</div>';
            mainContentHtml = `${goalHtml}<div class="layout-moves-container">${movesHtml}</div>`;
        } else {
            const detailHtml = fix.detail ? `<div class="fix-detail">${fix.detail}</div>` : '';
            const actionHtml = fix.measurableFix ? `<div class="fix-measurables">${fix.measurableFix}</div>` : '';
            mainContentHtml = `<div class="fix-content-block">${detailHtml}${actionHtml}</div>`;
        }
        const proUser = isProUser();
        let actionHtml = `
            <select class="strength-select" id="strength-${uniqueId}" onchange="handleStrengthChange(this)" style="background:rgba(255,255,255,0.1); color:#fff; border:1px solid rgba(255,255,255,0.2); padding:4px 8px; border-radius:4px; font-size:0.75rem; outline:none; margin-right: 8px;">
                <option value="low"${proUser ? '' : ' selected'}>Low (Fast)</option>
                <option value="high"${proUser ? ' selected' : ' disabled'}>${proUser ? 'High (Best)' : 'Locked: High (Best)'}</option>
            </select>
            <button class="btn-copy-fix btn-generate-fix" id="btn-gen-${uniqueId}" style="background: var(--color-primary); color: white; border: none; box-shadow: 0 0 10px rgba(59, 130, 246, 0.4);" onclick="generateFix('${uniqueId}', ${i}, '${containerId}')">${buttonText}</button>
        `;
        return `
        <div class="fix-item" id="${uniqueId}" data-apply-to='${JSON.stringify(fix.applyTo || [])}'>
            <div class="fix-header" onclick="toggleFix('${uniqueId}')">
                <div class="priority-chip p-${pClass}">${fix.priority}</div>
                <span class="fix-title-text">${fix.title}</span>
                <span class="fix-chevron">▾</span>
            </div>
            <div class="fix-body">
                 ${mainContentHtml}
                 <div class="fix-actions" style="display:flex; align-items:center; justify-content:flex-end; margin-top: 12px;">
                    ${actionHtml}
                 </div>
            </div>
        </div>
        `;
    }).join("");
    applyPlanAccessGates();
}

function renderTopProblems(containerId, problems) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!problems || problems.length === 0) {
        container.innerHTML = `<div class="p-4 text-white/50 text-sm">No top problems identified</div>`;
        return;
    }
    const proUser = isProUser();
    container.innerHTML = problems.map((prob, i) => {
        const uniqueId = `${containerId}-${i}`;
        let actionHtml = `
            <select class="strength-select" id="strength-${uniqueId}" onchange="handleStrengthChange(this)" style="background:rgba(255,255,255,0.1); color:#fff; border:1px solid rgba(255,255,255,0.2); padding:4px 8px; border-radius:4px; font-size:0.75rem; outline:none; margin-right: 8px;">
                <option value="low"${proUser ? '' : ' selected'}>Low (Fast)</option>
                <option value="high"${proUser ? ' selected' : ' disabled'}>${proUser ? 'High (Best)' : 'Locked: High (Best)'}</option>
            </select>
            <button class="btn-copy-fix btn-generate-fix" id="btn-gen-${uniqueId}" style="background: var(--color-danger); color: white; border: none; box-shadow: 0 0 10px rgba(239, 68, 68, 0.4);" onclick="generateFix('${uniqueId}', ${i}, '${containerId}')">Generate Fix</button>
        `;
        return `
        <div class="fix-item" id="${uniqueId}" data-apply-to='${JSON.stringify(prob.applyTo || [])}' style="border-left-color: #ff3b3b; background: rgba(0,0,0,0.2);">
            <div class="fix-header" onclick="toggleFix('${uniqueId}')">
                <span class="fix-title-text" style="color: #ffbba6; font-size: 0.95rem;">► ${prob.problem}</span>
                <span class="fix-chevron">▾</span>
            </div>
            <div class="fix-body">
                 <div class="fix-content-block" style="padding: 12px 16px; background: rgba(255,255,255,0.03); border-radius: 6px;">
                     <div class="fix-measurables" style="color: rgba(255,255,255,0.7); font-size: 0.85rem;">${prob.evidence}</div>
                 </div>
                 <div class="fix-actions" style="display:flex; align-items:center; justify-content:flex-end; margin-top: 12px;">
                    ${actionHtml}
                 </div>
            </div>
        </div>
        `;
    }).join("");
    applyPlanAccessGates();
}

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
        if (['hero', 'background', 'composition'].includes(id)) {
            if (id === 'hero') {
                const heroRegion = currentResult._regions.find(r => r.type === 'hero' || r.id === 'hero' || r.type === 'face');
                if (heroRegion) highlightSingleRegion(heroRegion, overlays);
            }
            return;
        }
        const region = currentResult._regions.find(r => r.id === id);
        if (region) highlightSingleRegion(region, overlays);
    });
}

function highlightSingleRegion(region, container) {
    const img = document.getElementById('main-thumbnail');
    const card = document.querySelector('.preview-container') || document.querySelector('.thumbnail-card');
    if (!img || !img.naturalWidth || !card) return;
    const cw = card.clientWidth, ch = card.clientHeight;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const scale = Math.min(cw / iw, ch / ih);
    const dw = iw * scale, dh = ih * scale;
    const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
    const x = dx + region.x * dw, y = dy + region.y * dh, w = region.w * dw, h = region.h * dh;
    const box = document.createElement("div");
    box.className = "region-box";
    box.style.left = `${x}px`; box.style.top = `${y}px`; box.style.width = `${w}px`; box.style.height = `${h}px`;
    if (region.isSuppressed) { box.dataset.suppressed = "true"; box.style.borderStyle = "dashed"; box.style.opacity = "0.7"; }
    const label = document.createElement("div");
    label.className = "region-label";
    label.textContent = region.displayName || (region.type === 'text' ? 'TEXT' : (region.label || region.id));
    box.appendChild(label);
    container.appendChild(box);
    if (x + 4 + label.offsetWidth > cw - 4) { label.style.left = 'auto'; label.style.right = '4px'; label.style.textAlign = 'right'; }
}

function toggleFix(id) {
    document.querySelectorAll('.fix-item.open').forEach(el => {
        if (el.id !== id) el.classList.remove('open');
    });
    const el = document.getElementById(id);
    if (!el) return;
    const isOpen = el.classList.toggle('open');
    if (isOpen) {
        const parts = id.split('-');
        const index = parseInt(parts.pop());
        const containerId = parts.join('-'); 
        let fix = null;
        if (containerId === 'quick-win-fixes') fix = currentResult.quickWinPlan.fixes[index];
        else if (containerId === 'high-impact-fixes') fix = currentResult.highImpactPlan.fixes[index];
        else if (containerId === 'top-problems-list') fix = currentResult.topProblems[index];
        if (fix) {
            const targets = fix.applyTo || (fix.target_region_id ? [fix.target_region_id] : []);
            if (targets.length > 0) highlightRegions(targets);
            else clearHighlights();
        }
    } else clearHighlights();
}

function renderResult(result) {
    if (!result) return;
    currentResult = result;
    els.scoreRing.style.setProperty("--percent", result.score);
    els.scoreRing.style.setProperty("--color", result.scoreColor);
    els.scoreValue.textContent = result.score;
    els.scoreValue.style.color = result.scoreColor;
    els.scoreText.textContent = `${result.score} / 100`;
    els.scoreText.style.color = result.scoreColor;
    if (els.verdictText) els.verdictText.textContent = result.verdict;
    if (els.weakestText) els.weakestText.textContent = (result.blockers || []).join(", ");
    if (!result.metrics || result.metrics.length === 0) {
        els.metricsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; opacity: 0.5;">No metrics available.</div>`;
    } else {
        els.metricsGrid.innerHTML = result.metrics.map(m => {
            const pct = m.max ? Math.round((m.val / m.max) * 100) : m.val;
            const safeWhy = (m.why || "").replace(/"/g, "&quot;");
            return `<div class="metric-card" onclick="showMetricWhy(this)" style="cursor: pointer;" data-why="${safeWhy}" data-label="${m.label}"><div class="metric-ring" style="--percent:${pct}; --color:${m.color}"><div class="metric-score">${m.val}</div></div><div class="metric-label">${m.label}</div></div>`;
        }).join("");
        let explainBox = document.getElementById('metric-explanation');
        if (!explainBox) {
            explainBox = document.createElement('div'); explainBox.id = 'metric-explanation';
            explainBox.style.cssText = `display: none; margin-top: 8px; padding: 16px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 12px; font-size: 0.9rem; color: rgba(255,255,255,0.9); line-height: 1.5; animation: fadeIn 0.3s ease;`;
            els.metricsGrid.parentNode.insertBefore(explainBox, els.metricsGrid.nextSibling);
        }
        explainBox.style.display = 'none'; explainBox.innerHTML = '';
        window.showMetricWhy = function (card) {
            const why = card.dataset.why, label = card.dataset.label;
            const box = document.getElementById('metric-explanation');
            if (box.dataset.activeLabel === label && box.style.display === 'block') {
                box.style.display = 'none'; box.dataset.activeLabel = '';
                card.style.borderColor = 'var(--border-subtle)'; card.style.background = 'var(--bg-card)';
                return;
            }
            document.querySelectorAll('.metric-card').forEach(c => { c.style.borderColor = 'var(--border-subtle)'; c.style.background = 'var(--bg-card)'; });
            card.style.borderColor = 'var(--color-primary)'; card.style.background = 'var(--bg-card-hover)';
            box.style.display = 'block'; box.dataset.activeLabel = label;
            box.innerHTML = `<strong style="color:var(--color-primary); display:block; margin-bottom:4px;">${label} Analysis</strong>${why}`;
        };
    }
    renderPlan('quick-win-fixes', result.quickWinPlan);
    renderPlan('high-impact-fixes', result.highImpactPlan);
    const probPanel = document.getElementById('top-problems-panel');
    if (probPanel) {
        if (result.topProblems && result.topProblems.length > 0) {
            probPanel.style.display = 'block';
            renderTopProblems('top-problems-list', result.topProblems);
        } else probPanel.style.display = 'none';
    }
    const noteEl = document.getElementById('high-impact-note');
    if (noteEl && result.highImpactPlan?.note) { noteEl.style.display = 'block'; noteEl.textContent = result.highImpactPlan.note; }
}

function copyText(text) { navigator.clipboard.writeText(text).then(() => { els.toast.classList.add("show"); setTimeout(() => els.toast.classList.remove("show"), 1500); }); }

document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !currentResult) return;
    const action = btn.dataset.action;
    if (action === 'copy-plan-quick') copyText(currentResult.quickWinPlan.fixes.map(f => `${f.priority}: ${f.measurableFix}`).join('\n'));
    else if (action === 'copy-plan-high') copyText(currentResult.highImpactPlan.fixes.map(f => `${f.priority}: ${f.measurableFix}`).join('\n'));
    else if (action === 'copy-summary') copyText(`Score: ${currentResult.score}\nVerdict: ${currentResult.verdict}\nBlockers: ${currentResult.blockers.join(', ')}`);
});

els.tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
        if (btn.dataset.group === "preview") {
            document.querySelectorAll('[data-group="preview"]').forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            const mode = btn.dataset.mode, img = document.getElementById("main-thumbnail");
            img.classList.remove("mode-squint", "mode-mobile");
            if (mode === "squint") img.classList.add("mode-squint");
            if (mode === "mobile") img.classList.add("mode-mobile");
        }
    });
});

const rescanBtn = document.getElementById("rescan-btn");
if (rescanBtn) {
    rescanBtn.addEventListener("click", async () => {
        rescanBtn.disabled = true;
        analysisCache.fast = analysisCache.normal = analysisCache.deep = null;
        try {
            const metrics = computeRetinaMetrics();
            const raw = await runAnalysis(currentTab, metrics);
            const normalized = normalizeResult(raw, currentTab);
            renderResult(normalized);
            updateUIWithMetrics(metrics);
        } catch (e) { } finally { rescanBtn.disabled = false; }
    });
}

async function init() {
    const stored = localStorage.getItem('linter_data');
    if (stored) {
        const data = JSON.parse(stored);
        if (data.imageUrlFull || data.imageData) {
            const img = document.getElementById('main-thumbnail'), src = data.imageUrlFull || data.imageData;
            img.onload = () => {
                const cvOrig = document.getElementById("cv_original"), cvMob = document.getElementById("cv_mobile");
                if (cvOrig && cvMob) { drawToCanvas(img, cvOrig, 960, 0); drawToCanvas(img, cvMob, 360, 2); }
                startAnalysisForSource(img);
            };
            img.src = src;
        }
    }
}

async function startAnalysisForSource(img) {
    try {
        const metrics = computeRetinaMetrics();
        const raw = await runAnalysis(currentTab, metrics);
        const normalized = normalizeResult(raw, currentTab);
        renderResult(normalized);
        updateUIWithMetrics(metrics);
    } catch (e) { hideLoading(); }
}

function updateUIWithMetrics(metrics) {
    const verdictText = document.getElementById("verdict-text"), mobilePass = metrics.mobile.pass;
    const badgeHtml = mobilePass ? `<span class="badge-pass" style="color:#4ade80;">Mobile: PASS ✅</span>` : `<span class="badge-fail" style="color:#f87171;">Mobile: FAIL ❌</span>`;
    if (verdictText) { const existing = verdictText.querySelector('.badge-pass, .badge-fail'); if (existing) existing.remove(); verdictText.insertAdjacentHTML('beforeend', badgeHtml); }
}

function drawToCanvas(img, canvas, targetW, blurPx = 0) {
    const ctx = canvas.getContext("2d"), scale = targetW / img.width, w = targetW, h = Math.round(img.height * scale);
    canvas.width = w; canvas.height = h; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;
    ctx.drawImage(img, 0, 0, w, h); ctx.filter = "none";
}

function lumaStats(imageData) {
    const d = imageData.data, n = d.length / 4, l = new Float32Array(n);
    let sum = 0; for (let i = 0, j = 0; i < d.length; i += 4, j++) { const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; l[j] = y; sum += y; }
    const mean = sum / n; let varSum = 0; for (let i = 0; i < n; i++) { const diff = l[i] - mean; varSum += diff * diff; }
    const sorted = Array.from(l).sort((a,b) => a-b); return { meanLuma: mean, stdLuma: Math.sqrt(varSum / n), dynRange: sorted[Math.floor(n * 0.95)] - sorted[Math.floor(n * 0.05)] };
}

function edgeDensitySobel(imageData) {
    const { width: w, height: h, data: d } = imageData, gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) { const idx = i * 4; gray[i] = 0.2126 * d[idx] + 0.7152 * d[idx + 1] + 0.0722 * d[idx + 2]; }
    const gxK = [-1, 0, 1, -2, 0, 2, -1, 0, 1], gyK = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    let edges = 0, total = 0; const TH = 80;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let gx = 0, gy = 0; for (let ky = -1; ky <= 1; ky++) { for (let kx = -1; kx <= 1; kx++) { const val = gray[(y + ky) * w + (x + kx)]; gx += val * gxK[(ky + 1) * 3 + (kx + 1)]; gy += val * gyK[(ky + 1) * 3 + (kx + 1)]; } }
            if (Math.sqrt(gx * gx + gy * gy) > TH) edges++;
            total++;
        }
    }
    return edges / total;
}

function computeRetinaMetrics() {
    const cOrig = document.getElementById("cv_original"), cMob = document.getElementById("cv_mobile");
    const imgO = cOrig.getContext("2d").getImageData(0, 0, cOrig.width, cOrig.height);
    const imgM = cMob.getContext("2d").getImageData(0, 0, cMob.width, cMob.height);
    const orig = lumaStats(imgO), mob = lumaStats(imgM), mobEdge = edgeDensitySobel(imgM);
    return { brightness: orig.meanLuma, contrastStd: orig.stdLuma, dynRange: orig.dynRange, mobile: { width: cMob.width, dynRange: mob.dynRange, edgeDensity: mobEdge, pass: !(mob.dynRange < 35 || mobEdge < 0.015) } };
}

const variantState = { original: null, variants: [], activeId: 'original' };
let previewGenerationCount = 0;

function setPreviewGenerating(isGenerating) {
    const card = document.getElementById('thumbnail-card'); if (!card) return;
    previewGenerationCount = isGenerating ? previewGenerationCount + 1 : Math.max(0, previewGenerationCount - 1);
    card.classList.toggle('generating', previewGenerationCount > 0);
}

function initVariantOriginal() {
    const img = document.getElementById('main-thumbnail');
    if (img && img.src) { variantState.original = img.src; const thumb = document.getElementById('thumb-orig'); if (thumb) thumb.src = img.src; }
}

function addVariant(imageUrl, fixTitle) {
    const id = `v${variantState.variants.length + 1}`;
    variantState.variants.push({ id, imageUrl, fixTitle, generatedAt: Date.now() });
    const strip = document.getElementById('variants-strip'); if (!strip) return id;
    const item = document.createElement('div'); item.className = 'variant-item'; item.dataset.id = id;
    item.onclick = () => selectVariant(id);
    item.innerHTML = `<img src="${imageUrl}" alt="${fixTitle}" class="variant-thumb"><span class="variant-label">${id.toUpperCase()}</span>`;
    strip.appendChild(item); selectVariant(id); return id;
}

function selectVariant(id) {
    variantState.activeId = id;
    document.querySelectorAll('.variant-item').forEach(el => el.classList.toggle('active', el.dataset.id === id));
    const img = document.getElementById('main-thumbnail'); if (!img) return;
    img.onload = null;
    if (id === 'original') img.src = variantState.original;
    else { const v = variantState.variants.find(v => v.id === id); if (v) img.src = v.imageUrl; }
}

function ensureFocusMode() {
    const container = document.querySelector('.dashboard-container');
    if (container && !container.classList.contains('focus-mode')) toggleFocusMode();
    const pb = document.getElementById('focus-prompt-bar'); if (pb) pb.style.display = 'flex';
}

function toggleFocusMode() {
    const c = document.querySelector('.dashboard-container'), btn = document.getElementById('focus-toggle-btn'); if (!c || !btn) return;
    const isFocus = c.classList.toggle('focus-mode');
    btn.classList.toggle('focus-active', isFocus);
}

async function generateFix(uniqueId, fixIndex, containerId) {
    const btn = document.getElementById(`btn-gen-${uniqueId}`), strengthSelect = document.getElementById(`strength-${uniqueId}`);
    if (!btn) return;
    let fix = null;
    if (containerId === 'quick-win-fixes') fix = currentResult.quickWinPlan.fixes[fixIndex];
    else if (containerId === 'high-impact-fixes') fix = currentResult.highImpactPlan.fixes[fixIndex];
    else if (containerId === 'top-problems-list') {
        const prob = currentResult.topProblems[fixIndex];
        if (prob) fix = { title: prob.problem, measurableFix: prob.evidence, priority: "CRITICAL" };
    }
    if (!fix) return;
    const strength = strengthSelect ? strengthSelect.value : 'low';
    if (strength === 'high' && !isProUser()) { window.location.href = 'pro-request.html'; return; }
    const originalBtnText = btn.textContent;
    ensureFocusMode(); if (!variantState.original) initVariantOriginal();
    setPreviewGenerating(true);
    try {
        btn.textContent = 'Generating Prompt…'; btn.disabled = true;
        const stored = JSON.parse(localStorage.getItem('linter_data') || '{}');
        const promptRes = await fetch(`${API_CONFIG.baseUrl}/generate-prompt`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fix: { title: fix.title, instruction: fix.measurableFix || fix.detail, priority: fix.priority }, game: window.__currentGame || '', baseImage: stored.imageUrlSmall || '', sceneSummary: currentResult?.sceneSummary || {}, styleRead: currentResult?.styleRead || {} })
        });
        if (!promptRes.ok) throw new Error('Prompt failed');
        const promptData = await promptRes.json();
        const promptInput = document.getElementById('focus-prompt-input'); if (promptInput) promptInput.value = promptData.prompt;
        btn.textContent = 'Generating Thumbnail…';
        const imageRes = await fetch(`${API_CONFIG.baseUrl}/generate-image`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseImage: document.getElementById('main-thumbnail')?.src || variantState.original, prompt: promptInput?.value || promptData.prompt, negativePrompt: promptData.negativePrompt || '', strength })
        });
        if (!imageRes.ok) throw new Error('Image failed');
        const imageData = await imageRes.json();
        addVariant(imageData.imageUrl, fix.title);
        btn.textContent = 'Fix Ready ✓';
    } catch (err) { btn.textContent = 'Failed'; }
    finally { setPreviewGenerating(false); setTimeout(() => { btn.textContent = originalBtnText; btn.disabled = false; }, 3000); }
}

async function generateFromFocusBox() {
    const btn = document.getElementById('focus-generate-btn'), input = document.getElementById('focus-prompt-input'), ms = document.getElementById('focus-model-select');
    if (!btn || !input) return;
    const rawPrompt = input.value.trim(); if (!rawPrompt) return;
    const strength = ms ? ms.value : 'low'; if (strength === 'high' && !isProUser()) { window.location.href = 'pro-request.html'; return; }
    const activeImage = document.getElementById('main-thumbnail')?.src || variantState.original;
    setPreviewGenerating(true);
    try {
        btn.innerHTML = 'Generating...'; btn.disabled = true;
        const res = await fetch(`${API_CONFIG.baseUrl}/generate-image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseImage: activeImage, prompt: rawPrompt, strength }) });
        if (!res.ok) throw new Error('Failed');
        const data = await res.json(); addVariant(data.imageUrl, "Custom Prompt"); btn.innerHTML = 'Done ✓';
    } catch (err) { btn.innerHTML = 'Failed'; }
    finally { setPreviewGenerating(false); setTimeout(() => { btn.disabled = false; btn.innerHTML = 'Generate'; }, 3000); }
}

document.addEventListener('DOMContentLoaded', () => {
    init();
    const focusGenBtn = document.getElementById('focus-generate-btn');
    if (focusGenBtn) focusGenBtn.addEventListener('click', generateFromFocusBox);
    const strip = document.getElementById('variants-strip');
    if (strip) strip.addEventListener('click', (e) => { const item = e.target.closest('.variant-item'); if (item) selectVariant(item.dataset.id); });
});
