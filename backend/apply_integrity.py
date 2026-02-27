import os

server_path = r'C:\Users\ACER\dashboard-linter\backend\server.js'

with open(server_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update runIntegrityValidators to return detailed structure
# We replace the entire function to include blocking logic
old_validator = """    const failures = results.filter(r => !r.valid);
    if (failures.length > 0) {
        console.log(`[INTEGRITY] ${failures.length} violations:`, failures.map(f => f.reason));
    }
    return failures;
}"""

new_validator = """    const failures = results.filter(r => !r.valid);
    
    // Step 1: Split into Blocking vs Warning
    const blocking = [];
    const warnings = [];

    for (const f of failures) {
        // Defines what is BLOCKING
        const isBlocking = 
            f.reason.includes("missing anchored evidence") ||
            f.reason.includes("missing anchored justification") ||
            f.reason.includes("Draft mode requires at least one structural fix") ||
            f.reason.includes("Contradictions");

        if (isBlocking) {
            blocking.push(f.reason);
        } else {
            warnings.push(f.reason);
        }
    }

    if (blocking.length > 0) {
        console.log(`[INTEGRITY] ${blocking.length} BLOCKING violations found -> repair needed:`, blocking);
    }
    if (warnings.length > 0) {
        console.log(`[INTEGRITY] ${warnings.length} warnings found (logged only):`, warnings);
    }

    return { blocking, warnings, all: failures };
}"""

if old_validator in content:
    content = content.replace(old_validator, new_validator)
    print("Updated runIntegrityValidators signature.")
else:
    print("Could not find runIntegrityValidators ending block.")


# 2. Update analyze_thumbnail to handle the repair loop
# We need to find the specific block where validation happens.
# Searching for: const integrityErrors = runIntegrityValidators(result, signals, regions, integrityContext);

target_block = """        // Integrity Check
        const integrityContext = { archetype: ctx.archetype, density: ctx.visualDensity, attention, mode };
        const integrityErrors = runIntegrityValidators(result, signals, regions, integrityContext);"""

replacement_block = """        // Integrity Check (Blocking + Repair)
        const integrityContext = { archetype: ctx.archetype, density: ctx.visualDensity, attention, mode };
        let integrityResult = runIntegrityValidators(result, signals, regions, integrityContext);

        // REPAIR LOOP (One-shot)
        if (integrityResult.blocking.length > 0) {
            console.log(`[VALIDATOR] Found ${integrityResult.blocking.length} blocking errors. Attempting repair...`);
            
            const repairPrompt = `
You have critical integrity violations. Fix ONLY these items. Do NOT change valid items.

VIOLATIONS:
${integrityResult.blocking.map(e => `- ${e}`).join('\\n')}

INSTRUCTIONS:
1. If missing anchored evidence: Add a sentence with a measured token (%, px) AND a causal connector (because, so, causing).
2. If missing anchored justification: Add "because [signal] causes [impact]".
3. If missing draft structural fix: Add one fix with "KEEP [region], REMOVE [region]" language.
4. Output the FULL corrected JSON.
`;
            
            // Re-call LLM
            const repairMessages = [
                ...messages,
                { role: 'assistant', content: JSON.stringify(result) },
                { role: 'user', content: repairPrompt }
            ];

            try {
                console.log('[LLM] Calling gpt-4o-mini (Repair: true)...');
                const completion = await openai.chat.completions.create({
                    model: LLM_MODEL,
                    messages: repairMessages,
                    response_format: { type: 'json_schema', json_schema: ANALYSIS_SCHEMA },
                    temperature: 0.3
                });

                if (completion.choices[0].message.content) {
                    const repaired = JSON.parse(completion.choices[0].message.content);
                    // Re-run validation
                    integrityResult = runIntegrityValidators(repaired, signals, regions, integrityContext);
                    
                    if (integrityResult.blocking.length === 0) {
                        console.log('[REPAIR] Success! Blocking violations cleared.');
                        result = repaired;
                    } else {
                        console.log('[REPAIR] Failed. Still has blocking violations:', integrityResult.blocking);
                        // Force degrade
                        result.quality = "degraded";
                        result.qualityReason = "integrity_fail_after_repair";
                    }
                }
            } catch (err) {
                console.error('[REPAIR] Error during repair:', err.message);
                result.quality = "degraded";
                result.qualityReason = "repair_crash";
            }
        }

        // DEGRADED MODE ENFORCEMENT
        if (result.quality === "degraded") {
            console.log('[DEGRADED] Enforcing degraded payload sanity...');
            // Ensure we at least have valid structure even if generic
            if (!result.quickWinPlan) result.quickWinPlan = { time: "5m", fixes: [] };
            if (!result.highImpactPlan) result.highImpactPlan = { time: "15m", fixes: [], note: "Service degraded." };
            
            // Force one draft collapse fix if missing
            if (mode === 'draft') {
                result.quickWinPlan.fixes.push({
                    priority: "P1",
                    pts: 10,
                    title: "Simplified Concept",
                    detail: "Concept is too complex.",
                    measurableFix: "KEEP the main hero, REMOVE all background elements.",
                    applyTo: ["global"],
                    evidence: "Scene is cluttered (causing confusion).",
                    lever: "composition"
                });
            }
        }"""

if target_block in content:
    content = content.replace(target_block, replacement_block)
    print("Updated analyze_thumbnail repair loop.")
else:
    # Try fuzzy match if exact failed
    print("Could not find analyze_thumbnail validation block. Check line endings?")

with open(server_path, 'w', encoding='utf-8') as f:
    f.write(content)
