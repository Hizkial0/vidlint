import re
import os

path = r'C:\Users\ACER\dashboard-linter\backend\server.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# STEP 0: MODEL PROBE & FALLBACK
# We need to inject the probe logic at startup and update callLLM to use the flag.

# 1. Add probe/flag variables
probe_logic = """
// Flag to track if gpt-5-mini is available
let canUseGpt5Mini = true;

// Startup Probe
(async function probeGpt5() {
    if (LLM_MODEL !== 'gpt-5-mini') {
        canUseGpt5Mini = false;
        return;
    }
    try {
        console.log('[PROBE] Checking gpt-5-mini availability...');
        await openai.chat.completions.create({
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1
        });
        console.log('[PROBE] gpt-5-mini is ACTIVE.');
        canUseGpt5Mini = true;
    } catch (e) {
        console.log(`[PROBE] gpt-5-mini failed (${e.status || e.code}). Fallback to gpt-4o-mini enforced.`);
        canUseGpt5Mini = false;
    }
})();
"""

# Inject after openai init
if "let canUseGpt5Mini" not in content:
    content = content.replace("const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });", 
                              "const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });\n" + probe_logic)
    print("Injected Model Probe.")

# 2. Update callLLM to respect the flag
old_call_llm = """async function callLLM(model, messages, attemptRepair = false) {
    try {
        console.log(`[LLM] Calling ${model} (Repair: ${attemptRepair})...`);

        // Both gpt-5-mini and gpt-4o-mini support json_schema (Structured Outputs)"""

new_call_llm = """async function callLLM(model, messages, attemptRepair = false) {
    // Step 0: Stability Override
    if (model === 'gpt-5-mini' && !canUseGpt5Mini) {
        model = 'gpt-4o-mini';
    }

    try {
        console.log(`[LLM] Calling ${model} (Repair: ${attemptRepair})...`);

        // Both gpt-5-mini and gpt-4o-mini support json_schema (Structured Outputs)"""

content = content.replace(old_call_llm, new_call_llm)
print("Updated callLLM to use stability flag.")


# STEP 3: RELAX MEASURABLE VALIDATOR
# Update hasMeasurableToken regex
old_regex = r"return /\(%\|px\|≤\|≥\|<=\|>=\|\\d\+\\s\*\(px\|%\)\|remove\\s\+\\d\+\|keep\\s\+\(only\\s\+\)\?\\w\+\|max\\s\+\\d\+\|scale\\s\+\(up\\s\+\)\?by\|\\d\+\\s\*words\?\)/i\.test\(s\);"
new_regex = r"return /(%|px|≤|≥|<=|>=|\d+\s*(px|%)|remove\s+\d+|keep\s+(only\s+)?\w+|max\s+\d+|scale\s+(up\s+)?by|\d+\s*words?|demote|promote|blur|desaturate|darken|delete|remove|keep|move|outline|stroke)/i.test(s);"

# Use regex sub because of escaping hell
content, n = re.subn(re.escape(old_regex), "return /(%|px|≤|≥|<=|>=|\d+\s*(px|%)|remove\s+\d+|keep\s+(only\s+)?\w+|max\s+\d+|scale\s+(up\s+)?by|\d+\s*words?|demote|promote|blur|desaturate|darken|delete|remove|keep|move|outline|stroke)/i.test(s);", content)
# Actually, escaping old_regex might disable the regex-ness of it in the source file?
# The source has a regex literal. 
# Let's try direct string replace with "return /.../i.test(s)" pattern
target_token_start = "return /(%|px|"
if target_token_start in content:
   # Find the end of the line
   start_idx = content.find(target_token_start)
   end_idx = content.find("test(s);", start_idx) + 8
   original_line = content[start_idx:end_idx]
   
   new_line = "return /(%|px|≤|≥|<=|>=|\\d+\\s*(px|%)|remove\\s+\\d+|keep\\s+(only\\s+)?\\w+|max\\s+\\d+|scale\\s+(up\\s+)?by|\\d+\\s*words?|demote|promote|blur|desaturate|darken|delete|remove|keep|move|outline|stroke)/i.test(s);"
   
   content = content.replace(original_line, new_line)
   print("Relaxed measurable token validator.")
else:
    print("Could not find measurable token validator regex.")


# STEP 4: REACTION FACE=0 FIX
# Update getArchetypeMission to handle reaction w/ no faces
mission_func_start = "function getArchetypeMission(archetype, density, gates, mode) {"
if mission_func_start in content:
    # We need to inject the check at the start
    injection = """    // Fix: Reaction archetype but NO faces -> Boss/Event Threat
    if (archetype === 'reaction' && gates && !gates.faceGrounded) {
        archetype = 'boss_threat'; // Override to threat/event focus
    }
"""
    replace_target = mission_func_start + "\n    let modeGoal = \"\";"
    content = content.replace(replace_target, mission_func_start + "\n" + injection + "    let modeGoal = \"\";")
    print("Injected Reaction Face=0 fix.")
else:
    print("Could not find getArchetypeMission.")

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
