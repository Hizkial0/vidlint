# 🧠 Analysis Framework - Architectural Breakdown

Here is a detailed breakdown of how the V1 Thumbnail Linter works. The system follows a **"Truth Hierarchy"** where physical evidence (CV) grounds AI assumptions (VLM), which then guide the Strategist (LLM).

---

## 1. The Intake Layer (Parallel "Eyes")
We run two analysis engines in parallel to gather data.

### A. Computer Vision (The Physicist)
*Driven by: Python (OpenCV, YOLO, EasyOCR, SigLIP)*  
Hard, measurable data. It doesn't "think"—it counts and measures.
- **Regions**: Detects Faces, Text, Heroes, and Objects. Returns stable IDs (e.g., `hero_1`, `text_2`) for targeting.
- **Signals**:
  - `mobile.dynRange`: Is the image muddy on small screens?
  - `ocr.textAreaPct`: Is there too much text?
  - `massPattern`: **[New]** Detects if objects form a "unified army/cluster" vs "messy clutter" (used to override Density gating).
  - `faceData`: **[New]** Counts faces and measures their size (used to ground "Reaction" hooks).

### B. Context Agent (The Analyst)
*Driven by: GPT-4o-Mini (Vision)*  
High-level semantic understanding. It looks at the image and guesses:
- **Archetype**: (e.g., "Reaction", "Transformation", "Scale Mass")
- **Surface**: (e.g., "Browse", "Search", "Suggested")
- **Confidence**: It assigns a % score to its own guesses.

---

## 2. The Gating Policy (The Filter)
*Driven by: server.js Logic*  
Before sending data to the Strategist, we sanitize it to prevent "AI hallucinations."

- **The Problem**: AI loves to hallucinate rules. If it sees a messy room, it might guess "Pattern Mass" logic applies, even if it's just a mess.
- **The Solution (Gates)**:
  - **Gate A (Confidence)**: If the Context Agent isn't sure (`< 55%`), we mark the context as "Mixed" and disable strict rules.
  - **Gate B (Archetype + Density)**: We ONLY allow the "Pattern Mass" rule if:
    1. The Agent is 60% sure it's an Archetype.
    2. **AND** The CV `massPattern` confirms physical clustering (Physical Evidence > AI Assumption).
  - **Gate C (Surface)**: Surface-specific rules (like "Browse needs cold hooks") are only applied if confidence is very high (`≥ 75%`).

*Result*: A `normalizedContextPack` that is "safe" to use.

---

## 3. The Strategist (The Decision Maker)
*Driven by: GPT-5-Mini*  
This is the core intelligence. It receives a **"Grounding Packet"**:
1. **User Context**: (Game, Mode)
2. **Signals**: (Mobile pass/fail, text stats)
3. **Region Map**: ("hero_1 is at top-left")
4. **Context Pack**: (The sanitized archetype info)
5. **Injected Rules**: (Specific instructions like "Face is the Hook" injected *only* if Gates passed).

**Job**: Produce a JSON plan with:
- **Score (0-100)**: Based on clear metrics (CLARITY, HOOK, etc.).
- **Blockers**: The top 2 reasons the thumbnail fails.
- **Fix Plan**: 3 Quick Wins + 2 High Impact fixes.
- **Constraint**: *Every fix must target a specific Region ID.*

---

## 4. The Validator (The Guardrails)
*Driven by: server.js Logic*  
The Strategist's output is *never* trusted blindly. It goes through a rigorous check:

1. **Hallucination Check**: "You said fix `hero_2`, but `hero_2` does not exist." -> **Rejected**.
2. **Physics Check**: "You said remove text, but there is no text." -> **Rejected**.
3. **Logic Check**: "You said increase brightness, but that's generic advice." -> **Rejected**. 
   - *Requirement*: Must say "Increase brightness *on the zombie face (hero_1)*".

*Self-Repair*: If the validator fails, the system sends the error back to the LLM: "You referenced a fake region. Try again." (Max 1 retry).

---

## 5. The Output (The Dashboard)
The final clean JSON is sent to the frontend.
- **Preview**: Region IDs are visualized using the coordinate data from Stage 1.
- **Assumption**: The "Best-fit" line (which we just hid from UI) shows what the Context Agent *thought*, but the scoring reflects what the Gating Policy *permitted*.

---

## 6. Technology Stack & Models

### Core Intelligence
- **Strategist (LLM)**: `GPT-5-Mini` (High reasoning, structured JSON output).
- **Context Agent (VLM)**: `GPT-4o-Mini` (Vision capabilities for archetype classification).

### Computer Vision (The "Physicist")
All hosted in the Python Microservice (`analyzer/app.py`).
- **Object Detection**: `YOLO11s` (State-of-the-art detection for heroes/faces).
- **Text Extraction**: `EasyOCR` (Robust text localization).
- **Style Classification**: `SigLIP` (Semantic signal for "Authentic vs. Rendered").
- **Metrics**: `OpenCV` + `NumPy` (Raw pixel math for contrast, edge density).

### Infrastructure
- **Backend**: Node.js (Express, Orchestration).
- **Analyzer**: Python (FastAPI, PyTorch/TorchVision).
- **Frontend**: Vanilla JS (Lightweight, no build step).
