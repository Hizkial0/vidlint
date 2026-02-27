const DEMO_RESULTS = {
    // --- GTA ---
    "gta_normal": {
        score: 93,
        scoreColor: "#4ade80",
        verdict: "FIX then publish",
        blockers: ["CLEAN", "TRUST"],
        metrics: [
            { label: "POP", val: 19, max: 20, color: "#4ade80" },
            { label: "CLARITY", val: 18, max: 20, color: "#4ade80" },
            { label: "HOOK", val: 17, max: 20, color: "#4ade80" },
            { label: "CLEAN", val: 15, max: 20, color: "#fbbf24" },
            { label: "TRUST", val: 16, max: 20, color: "#fbbf24" },
        ],
        quickWinPlan: {
            time: "10–25 min",
            fixes: [
                {
                    priority: "P1",
                    pts: 8,
                    title: "Collapse the chaos into one moment",
                    applyTo: ["bg_1"],
                    detail: "Right now there are multiple 'events' competing, so nothing reads instantly.",
                    measurableFix: "Pick ONE impact moment and delete the rest. Remove 2 explosion elements so only a single blast remains as the hero moment. The viewer should understand the entire thumbnail in 0.5 seconds: one threat, one impact, one outcome."
                },
                {
                    priority: "P2",
                    pts: 6,
                    title: "Fix the sticker look (trust hit)",
                    applyTo: ["hero_1"],
                    detail: "Your cutouts look pasted on, which lowers trust instantly in gaming feeds.",
                    measurableFix: "Under the main monster cutout (hero_1), add one grounding shadow: 30% opacity with 20px blur. Keep it anchored directly under the feet/lowest contact points so it feels in-scene, not floating."
                },
                {
                    priority: "P3",
                    pts: 3,
                    title: "Unify the grade so assets belong together",
                    applyTo: ["global"],
                    detail: "Different saturation/contrast makes the image feel 'assembled' instead of real.",
                    measurableFix: "Apply ONE Curves layer over the full image and match midtones across all cutouts. Don't add more effects—just make every element look like it was captured in the same lighting."
                }
            ]
        },
        highImpactPlan: {
            time: "20–90 min",
            fixes: [
                {
                    priority: "P1",
                    pts: 15,
                    title: "Hero dominance (mobile-first)",
                    applyTo: ["hero_1"],
                    detail: "If the monster doesn't dominate, the click dies on mobile.",
                    measurableFix: "Scale hero_1 up by ~30% and crop tighter until the monster occupies ~25–35% of the frame. You're selling the threat—make the threat unavoidable."
                },
                {
                    priority: "P2",
                    pts: 10,
                    title: "Reduce to 1 hero + 1 threat (no extras)",
                    applyTo: ["global"],
                    detail: "Extra props lower CTR because they slow comprehension.",
                    measurableFix: "Remove any third subject and background props until only two big reads remain: one hero and one threat. Keep the background simple enough that the subjects pop without needing brightness hacks."
                }
            ],
            note: "May include a frame/style change if required by trust/clarity gates."
        },
        layoutOptions: [
            {
                label: "A",
                steps: [
                    "Hero vs Threat: hero_1 fills right ~60%, opponent fills left ~40%.",
                    "Keep one short hook at top-left and leave bottom-right clear for timestamp."
                ]
            },
            {
                label: "B",
                steps: [
                    "Threat Center: hero_1 centered and cropped tight (let edges break frame).",
                    "Add ONE proof badge near top-center; remove all other text."
                ]
            }
        ],
        copyButtons: ["Copy Quick Win Plan", "Copy High-Impact Plan", "Copy Fix", "Copy Layouts", "Copy Summary"]
    },

    "gta_fast": {
        score: 45,
        scoreColor: "#ff3b3b",
        verdict: "NEEDS WORK before publish",
        blockers: ["CLARITY", "TRUST"],
        metrics: [
            { label: "CLARITY", val: 8, max: 25, color: "#ff3b3b" },
            { label: "HOOK", val: 15, max: 25, color: "#fbbf24" },
            { label: "VISUALABILITY", val: 10, max: 25, color: "#ff3b3b" },
            { label: "CLEAN", val: 12, max: 25, color: "#fbbf24" },
        ],
        quickWinPlan: {
            time: "15–30 min",
            fixes: [
                {
                    priority: "P1",
                    pts: 15,
                    title: "Your hero is invisible at mobile scale",
                    applyTo: ["hero_1"],
                    detail: "At 120px wide (feed size), the main subject disappears into the background noise.",
                    measurableFix: "Scale hero_1 up by 30–40% until it occupies at least 25% of the frame. Crop the canvas if needed—better to lose background than lose the click."
                },
                {
                    priority: "P2",
                    pts: 10,
                    title: "Too many elements competing for attention",
                    applyTo: ["bg_1"],
                    detail: "The eye doesn't know where to land first, so it bounces and scrolls past.",
                    measurableFix: "Remove or blur 2–3 background props until the scene has exactly ONE focal point. If it's a car, remove extra cars. If it's a character, remove extra characters."
                },
                {
                    priority: "P3",
                    pts: 5,
                    title: "The hero looks pasted, not present",
                    applyTo: ["hero_1"],
                    detail: "Missing shadows and mismatched lighting make it feel like a cheap edit.",
                    measurableFix: "Add a 30% opacity drop shadow under hero_1 (20px blur, offset toward light source). Match the hero's color temperature to the background."
                }
            ]
        },
        highImpactPlan: {
            time: "30–90 min",
            fixes: [
                {
                    priority: "P1",
                    pts: 20,
                    title: "The concept doesn't hook in 0.5s",
                    applyTo: ["global"],
                    detail: "A good thumbnail is a billboard, not a movie poster. You need ONE idea, not five.",
                    measurableFix: "Rebuild the concept around a single 'what if' moment: one hero, one threat, one outcome. Kill everything else. The viewer should understand the video's promise before they can read the title."
                },
                {
                    priority: "P2",
                    pts: 12,
                    title: "Wrong framing for the platform",
                    applyTo: ["hero_1"],
                    detail: "Wide compositions die on mobile. Tight crops win.",
                    measurableFix: "Re-crop to 16:9 with the hero filling 35%+ of the frame. Use the edges of the frame aggressively—let elements break out if it sells the energy."
                }
            ],
            note: "This draft needs a clarity rethink. Quick fixes won't fully save it."
        },
        layoutOptions: [
            { label: "A", steps: ["Threat Center: Focus entirely on the monster, background blur.", "Single text line at top."] },
            { label: "B", steps: ["Hero vs Threat: Balanced conflict 50/50 composition.", "Diagonal split or versus frame."] }
        ],
        copyButtons: ["Copy Quick Win Plan", "Copy High-Impact Plan", "Copy Summary", "Copy Layout"]
    },

    "gta_deep": {
        score: 98,
        scoreColor: "#4ade80",
        verdict: "Perfect! Ready to publish",
        blockers: ["None"],
        metrics: [
            { label: "POP", val: 20, max: 20, color: "#4ade80" },
            { label: "CLARITY", val: 19, max: 20, color: "#4ade80" },
            { label: "HOOK", val: 20, max: 20, color: "#4ade80" },
            { label: "CLEAN", val: 19, max: 20, color: "#4ade80" },
            { label: "TRUST", val: 20, max: 20, color: "#4ade80" }
        ],
        quickWinPlan: { time: "0 min", fixes: [] },
        highImpactPlan: { time: "0 min", fixes: [], note: "Deep analysis complete." },
        layoutOptions: [],
        copyButtons: ["Copy Summary"]
    },

    // --- MINECRAFT ---
    "minecraft_normal": {
        score: 91,
        scoreColor: "#4ade80",
        verdict: "FIX then publish",
        blockers: ["TEXT", "CLUTTER"],
        metrics: [
            { label: "POP", val: 16, max: 20, color: "#fbbf24" },
            { label: "CLARITY", val: 17, max: 20, color: "#4ade80" },
            { label: "HOOK", val: 19, max: 20, color: "#4ade80" },
            { label: "CLEAN", val: 19, max: 20, color: "#4ade80" },
            { label: "TRUST", val: 18, max: 20, color: "#4ade80" },
        ],
        quickWinPlan: {
            time: "10–20 min",
            fixes: [
                {
                    priority: "P1",
                    pts: 12,
                    title: "Delete the middle sign text",
                    applyTo: ["text_2"],
                    detail: "The center badge ('MONSTER BATTLE ARENA') steals attention from the actual fight and slows comprehension.",
                    measurableFix: "On text_2 (center), delete this text block entirely; keep only text_1 (bottom title 'BATTLE MUTANTS'). Two competing text blocks = neither gets read. One bold title = instant hook."
                },
                {
                    priority: "P2",
                    pts: 8,
                    title: "Scale up both heroes so they pop at mobile",
                    applyTo: ["hero_1", "hero_2"],
                    detail: "The mutants are too small to read at 120px feed width. Mobile users scroll past.",
                    measurableFix: "Scale hero_1 and hero_2 up by 25% each, letting them break into the edges if needed. The 'battle' premise only works if both fighters are immediately visible at small sizes."
                },
                {
                    priority: "P3",
                    pts: 4,
                    title: "Add outline pop to separate from background",
                    applyTo: ["hero_1", "hero_2"],
                    detail: "The Minecraft block style means edges blend. Outlines fix this.",
                    measurableFix: "Add 3px white stroke around hero_1 and hero_2. Keep it tight and clean—no glow, just a hard outline to separate them from the busy arena background."
                }
            ]
        },
        highImpactPlan: {
            time: "20–45 min",
            fixes: [
                {
                    priority: "P1",
                    pts: 15,
                    title: "Simplify to ONE focal moment",
                    applyTo: ["global"],
                    detail: "Right now there's an arena, crowd, sign, two fighters—too many elements.",
                    measurableFix: "Remove the arena crowd or blur them to 10px. Keep only the two heroes and ONE text block. The thumbnail should read as 'two giants fighting' in under 0.5 seconds."
                },
                {
                    priority: "P2",
                    pts: 10,
                    title: "Contrast boost for mobile legibility",
                    applyTo: ["background"],
                    detail: "Minecraft's flat colors can look muddy at small sizes.",
                    measurableFix: "Increase background/foreground separation by darkening the arena floor 15% and brightening the heroes 10%. The heroes should visually 'pop off' the background."
                }
            ],
            note: "If text cleanup doesn't feel enough, consider a full re-render with simpler staging."
        },
        layoutOptions: [
            { label: "A", steps: ["Head-to-Head: hero_1 left 45%, hero_2 right 45%, text bottom 10%.", "Diagonal energy line between them."] },
            { label: "B", steps: ["Boss Focus: hero_1 centered and cropped tight as 'the threat'.", "Challenger (hero_2) smaller in corner."] }
        ],
        copyButtons: ["Copy Quick Win Plan", "Copy High-Impact Plan", "Copy Summary", "Copy Layout"]
    },

    "minecraft_fast": {
        score: 52,
        scoreColor: "#fbbf24",
        verdict: "NEEDS WORK before publish",
        blockers: ["CLARITY", "POP"],
        metrics: [
            { label: "CLARITY", val: 12, max: 25, color: "#fbbf24" },
            { label: "HOOK", val: 15, max: 25, color: "#fbbf24" },
            { label: "VISUALABILITY", val: 10, max: 25, color: "#ff3b3b" },
            { label: "CLEAN", val: 15, max: 25, color: "#fbbf24" },
        ],
        quickWinPlan: {
            time: "15–30 min",
            fixes: [
                {
                    priority: "P1",
                    pts: 15,
                    title: "The subject is too small to see on mobile",
                    applyTo: ["hero_1"],
                    detail: "At feed size, the main mob/item blends into the background.",
                    measurableFix: "Scale hero_1 up by 30–40% until it fills at least 25% of the frame. Don't worry about cropping other elements—the hero needs to dominate."
                },
                {
                    priority: "P2",
                    pts: 10,
                    title: "Too many text blocks competing",
                    applyTo: ["text_1", "text_2"],
                    detail: "Multiple text elements = nothing gets read.",
                    measurableFix: "Delete text_2 and keep only text_1. If text_1 is weak, rewrite it to 3 words max. Big, bold, readable at 120px width."
                },
                {
                    priority: "P3",
                    pts: 5,
                    title: "No visual separation from background",
                    applyTo: ["hero_1"],
                    detail: "Minecraft's blocky style needs outlines to pop.",
                    measurableFix: "Add 3–4px white outline around hero_1. No glow, no shadow—just a clean hard edge."
                }
            ]
        },
        highImpactPlan: {
            time: "30–60 min",
            fixes: [
                {
                    priority: "P1",
                    pts: 20,
                    title: "Concept doesn't hook fast enough",
                    applyTo: ["global"],
                    detail: "Good Minecraft thumbnails sell ONE transformation or reveal.",
                    measurableFix: "Rebuild around '100 Days progression' (before/after split) or 'one giant item/build' (single focus). Pick one concept and commit."
                },
                {
                    priority: "P2",
                    pts: 12,
                    title: "Background is too busy",
                    applyTo: ["background"],
                    detail: "Complex backgrounds compete with the subject.",
                    measurableFix: "Blur background to 8–10px or replace with simple gradient. The hero should be the ONLY sharp element."
                }
            ],
            note: "Draft needs concept work, not just polish."
        },
        layoutOptions: [
            { label: "A", steps: ["Before/After: 100 Days progression split.", "Use diagonal split line."] },
            { label: "B", steps: ["Big Item Focus: Single object dominance.", "Blur background heavily."] }
        ],
        copyButtons: ["Copy Quick Win Plan", "Copy High-Impact Plan", "Copy Summary", "Copy Layout"]
    },

    // --- GENERIC SHOOTER ---
    "shooter_normal": {
        score: 85,
        scoreColor: "#4ade80",
        verdict: "Ready to publish",
        blockers: ["POP", "HOOK"],
        metrics: [
            { label: "POP", val: 15, max: 20, color: "#fbbf24" },
            { label: "CLARITY", val: 18, max: 20, color: "#4ade80" },
            { label: "HOOK", val: 16, max: 20, color: "#fbbf24" },
            { label: "CLEAN", val: 19, max: 20, color: "#4ade80" }
        ],
        quickWinPlan: {
            time: "10–15 min",
            fixes: [
                {
                    priority: "P1",
                    pts: 5,
                    title: "The weapon is too small to sell the fantasy",
                    applyTo: ["hero_1"],
                    detail: "Shooter thumbnails live and die by weapon presence.",
                    measurableFix: "Scale the weapon up 20% and position it so it crosses into the foreground. The gun should feel like it's pointed at the viewer."
                },
                {
                    priority: "P2",
                    pts: 4,
                    title: "Muzzle flash isn't bright enough to pop",
                    applyTo: ["hero_1"],
                    detail: "Action needs to feel kinetic, not static.",
                    measurableFix: "Brighten the muzzle flash by 15% and add a subtle radial glow. The flash should be the brightest point in the frame."
                },
                {
                    priority: "P3",
                    pts: 3,
                    title: "Missing social proof element",
                    applyTo: ["text_1"],
                    detail: "High-kill games or streamer content needs proof.",
                    measurableFix: "Add a subtle killfeed line or damage number in the style of the game. Keep it readable but not dominant."
                }
            ]
        },
        highImpactPlan: {
            time: "20–40 min",
            fixes: [
                {
                    priority: "P1",
                    pts: 10,
                    title: "Static framing kills the energy",
                    applyTo: ["global"],
                    detail: "A flat horizon feels like a screenshot, not a moment.",
                    measurableFix: "Tilt the horizon 10–15 degrees. This adds cinematic energy without making it unreadable. Match the tilt to the action direction."
                },
                {
                    priority: "P2",
                    pts: 8,
                    title: "Character doesn't pop off the background",
                    applyTo: ["hero_1"],
                    detail: "Shooter thumbnails need strong rim lighting to separate elements.",
                    measurableFix: "Add a strong rim light (back lighting) to the character's silhouette. Color it to match the game's palette—blue for futuristic, orange for gritty."
                }
            ]
        },
        layoutOptions: [
            { label: "A", steps: ["Weapon Focus: Gun takes 40% of screen, angled toward viewer.", "Character as context behind."] },
            { label: "B", steps: ["Face Reaction: Streamer face 50% scale with genuine reaction.", "Gameplay moment behind at 50%."] }
        ],
        copyButtons: ["Copy Quick Win Plan", "Copy High-Impact Plan", "Copy Summary", "Copy Layout"]
    }
};
