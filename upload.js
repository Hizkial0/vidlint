// ---- CONFIG ----
const CLOUD_NAME = "dab3tied3";         // User Provided Cloud Name
const UPLOAD_PRESET = "thumb_linter";      // Unsigned preset name
const UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

// ---- STATE ----
let selectedFile = null;
let mode = "fast";

// ---- ELEMENTS ----
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const contextInput = document.getElementById("contextInput");
const gameInput = document.getElementById("gameInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const statusText = document.getElementById("statusText");


// ---- HELPERS ----
function setStatus(msg) {
    if (statusText) statusText.textContent = msg;
}

function setAnalyzeEnabled() {
    // Context is always optional now with these modes
    analyzeBtn.disabled = !selectedFile;
}



function validateFile(file) {
    const okType = ["image/png", "image/jpeg"].includes(file.type);
    const okSize = file.size <= 5 * 1024 * 1024; // 5MB
    if (!okType) return "Only PNG/JPG allowed.";
    if (!okSize) return "File too large (max 5MB).";
    return null;
}

async function uploadToCloudinary(file) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", UPLOAD_PRESET);

    const res = await fetch(UPLOAD_URL, { method: "POST", body: fd });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Upload failed: ${txt}`);
    }
    return await res.json();
}

function buildSmallUrl(publicId) {
    // cheap AI / processing URL
    return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/w_512,q_auto,f_auto/${publicId}`;
}

// ---- EVENTS ----


contextInput?.addEventListener("input", setAnalyzeEnabled);

dropzone.addEventListener("click", () => fileInput.click());

dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
});

dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("drag-over");
});

dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const err = validateFile(file);
    if (err) return setStatus(err);

    selectedFile = file;
    setStatus(`Selected: ${file.name}`);
    setAnalyzeEnabled();

    // Local preview immediately
    showPreview(file);
});

fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const err = validateFile(file);
    if (err) return setStatus(err);

    selectedFile = file;
    setStatus(`Selected: ${file.name}`);
    setAnalyzeEnabled();
    showPreview(file);
});

function showPreview(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
        const placeholder = document.getElementById("upload-placeholder");
        if (placeholder) placeholder.style.display = "none";

        let img = dropzone.querySelector(".upload-preview");
        if (!img) {
            img = document.createElement("img");
            img.className = "upload-preview";
            // precise styling to match design
            img.style.width = "100%";
            img.style.height = "auto";
            img.style.borderRadius = "12px";
            img.style.boxShadow = "0 4px 20px rgba(0,0,0,0.3)";
            img.style.margin = "0";
            img.style.display = "block";
            dropzone.appendChild(img);
        }
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

analyzeBtn.addEventListener("click", async () => {
    try {
        analyzeBtn.disabled = true;
        setStatus("Uploading…");

        const ctx = (contextInput?.value || "").trim();
        const titleVal = (document.getElementById('titleInput')?.value || "").trim();
        const modeInput = document.querySelector('input[name="upload-mode"]:checked');
        const selectedMode = modeInput ? modeInput.value : "fast";

        const up = await uploadToCloudinary(selectedFile);
        const imageUrlFull = up.secure_url;
        const publicId = up.public_id;
        const imageUrlSmall = buildSmallUrl(publicId);

        // Save for results page (same key your results page already reads)
        localStorage.setItem("linter_data", JSON.stringify({
            title: titleVal,
            game: gameInput?.value || "gta",
            mode: selectedMode,                 // "fast" | "high" 
            context: ctx,
            imageUrlFull,
            imageUrlSmall,
            publicId,
            // Fallback base64 removed to rely on cloud URL, 
            // but if you wanted 'instant' local preview you could store it too.
            // We will rely on URL.
            timestamp: Date.now()
        }));

        setStatus("Done. Opening results…");
        window.location.href = "results.html";
    } catch (err) {
        console.error(err);
        let msg = err.message || "Upload failed.";
        if (msg.includes("Unknown API key")) {
            msg += " (Check: Is your 'thumb_linter' preset set to UNSIGNED in Cloudinary?)";
        }
        setStatus(msg);
        setAnalyzeEnabled();
    }
});

// ---- GAME DROPDOWN LOGIC ----
const gameSearch = document.getElementById("gameSearch");
const gameOptions = document.getElementById("gameOptions");

const GAME_OPTS = [
    { label: "Minecraft", value: "minecraft" },
    { label: "GTA V", value: "gta" },
    { label: "Fortnite", value: "fortnite" },
    { label: "Roblox", value: "roblox" },
    { label: "Call of Duty (Warzone / MW3)", value: "cod" },
    { label: "Valorant", value: "valorant" },
    { label: "CS2", value: "cs2" },
    { label: "Overwatch 2", value: "overwatch" },
    { label: "Apex Legends", value: "apex" },
    { label: "Rainbow Six Siege", value: "siege" },
    { label: "PUBG", value: "pubg" },
    { label: "Rocket League", value: "rocketleague" },
    { label: "League of Legends", value: "lol" },
    { label: "Dota 2", value: "dota2" },
    { label: "EA FC (FIFA)", value: "eafc" },
    { label: "Among Us", value: "amongus" },
    { label: "FiveM / GTA RP", value: "fivem" },
    { label: "Genshin Impact", value: "genshin" },
    { label: "Brawl Stars", value: "brawl" },
    { label: "Clash Royale", value: "clash" },
    { label: "Free Fire", value: "freefire" },
    { label: "Mobile Legends", value: "mlbb" }
];

function initGameDropdown() {
    if (!gameSearch || !gameOptions) return;

    function renderOptions(filterText = "") {
        const lower = filterText.toLowerCase();
        const filtered = GAME_OPTS.filter(g => g.label.toLowerCase().includes(lower));

        if (filtered.length === 0) {
            gameOptions.innerHTML = `<div class="dropdown-option" style="color:var(--text-muted); cursor:default;">No matches found</div>`;
        } else {
            gameOptions.innerHTML = filtered.map(g => `
                <div class="dropdown-option" data-value="${g.value}" data-label="${g.label}">
                    ${g.label}
                </div>
            `).join("");
        }

        // click handlers
        gameOptions.querySelectorAll(".dropdown-option").forEach(opt => {
            if (!opt.dataset.value) return; // skip 'no matches'
            opt.addEventListener("click", () => {
                selectGame(opt.dataset.value, opt.dataset.label);
            });
        });
    }

    function selectGame(val, label) {
        gameInput.value = val;
        gameSearch.value = label; // Show nice name
        gameOptions.classList.remove("show");
    }

    // Default load
    renderOptions();

    // Search Input
    gameSearch.addEventListener("focus", () => {
        renderOptions(gameSearch.value);
        gameOptions.classList.add("show");
    });

    gameSearch.addEventListener("input", (e) => {
        renderOptions(e.target.value);
        gameOptions.classList.add("show");
    });

    // Close on click outside
    document.addEventListener("click", (e) => {
        if (!gameSearch.contains(e.target) && !gameOptions.contains(e.target)) {
            gameOptions.classList.remove("show");
        }
    });
}

initGameDropdown();

// init defaults
setAnalyzeEnabled();
