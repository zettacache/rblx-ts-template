# Presentation direction

Use this guide before designing player-facing UI, environments, models, animation, VFX or SFX. The template supplies a process and a worked visual reference, not a finished game's identity. Choose a project direction once, then carry its shape, color, material and timing decisions through every discipline.

## Start with a point of view

The example direction is **crafted adventure**: generous shapes, ink-blue surfaces, warm ivory type, mineral mint interaction accents, and small brass highlights. Quiet framing lets characters, rewards and action carry the spectacle. The existing loading screen already uses the ink/mint family. The [style lab](../ui/style-lab/prototype.html) explores a richer inventory and feedback treatment without changing that runtime screen.

This is a starting example, not a mandatory skin for every game. A racing game, cozy builder and horror game should have different visual identities. Before producing assets, fill out the [feature brief](feature-brief.md) with three specific style adjectives and three exclusions, a shape language, palette roles and an emotional target. Replace the example decisions together, rather than mixing unrelated attractive references.

## Build a reference set that teaches

Collect 6–12 references across interface, world, character, motion and sound. Screenshots supplied by the user are especially useful. For each, record its source, what works, what to borrow as a principle, what to avoid and the player context. A screenshot establishes composition; use short clips for timing and sound. Record timestamps and source/access information for audio. References are direction, not permission to redistribute another game's assets.

Compare two or three small concepts before selecting one. Explain the choice using player readability, personality and production cost. Save editable sources and rejected concepts under the feature's `docs/ui/` or `assets/` directory. Do not block an authorized task waiting for optional references: label assumptions and make the first direction reviewable.

The [reference library](references/README.md) records observations separately from interpretations and decisions. Start with the user's supplied references; do not assume that every visible detail is endorsed. Extract transferable principles before choosing their visual expression. A static image does not establish interaction quality, motion, sound, mobile behavior or commercial results.

## Quality principles and style choices

Polish comes from deliberate hierarchy, consistency, legibility, feedback and fit to the player task. It does not require a quiet palette or sparse composition. A dense, saturated arcade interface can be well crafted; a minimal interface can be confusing. Judge each against its intended experience.

| Keep across games                                         | Choose for each game's identity                                      |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| The next action is easy to find                           | Saturated spectacle, muted atmosphere or something between           |
| Text and controls separate from the scene                 | Outlines, solid panels, restrained translucency or local scrims      |
| Component anatomy and state meanings repeat               | Chunky bevels, illustrated frames, flat surfaces or fine borders     |
| Icons read at their actual display size                   | Glossy cartoon objects, simple glyphs or painted motifs              |
| Numbers reveal a decision and its consequence             | Playful display type, utilitarian sans serif or editorial typography |
| Feedback is timely and proportionate                      | Elastic bounce, mechanical snap or soft dissolve                     |
| Important information survives color/audio/motion changes | Theme-specific palette, sound palette and effect language            |

For example, an upgrade can always show **current value → next value**, its cost, and availability in stable positions. An arcade game might express this with ivory cards, bold outlined numbers and raised green buttons; a cozy game with paper labels and a soft pressed state; a science-fiction game with aligned instrument readouts and crisp focus frames. Preserve the decision structure while changing the visual vocabulary together.

Write a small project style contract: outline weights, corner/proportion families, lighting direction on icons, font roles, surface depth, palette meanings, density and motion character. Review whether components obey that contract. Do not inherit the crafted-adventure tokens merely because they are the first example in this repository.

## Match fidelity across the whole screen

UI, icons and featured illustrations must feel authored together. Pick a common level of detail and a common rendering language before producing assets. Compare contour weight at displayed size, shape proportions, perspective, light direction, shading steps, highlight shape, texture density and saturation. A shared palette alone does not make a glossy rendered object belong beside simple diagram-like icons.

Polish is resolution of the chosen style, not the amount of detail. A simple interface can be polished through precise alignment, spacing, type, states and consistent forms. When the UI uses broad surfaces and simple shading, simplify assets to the same language. Highly detailed assets belong with comparably resolved UI surfaces and supporting icons; do not use one elaborate illustration to compensate for an underdeveloped interface. If the desired direction is richer, develop the UI and the whole icon family together.

Hero art can be larger and more expressive without changing styles. Add composition and scale before adding texture or a different lighting model. Review a representative button, card, small icon and hero asset together at native desktop and phone sizes. Reject a combination that feels like assets pasted from different packs, even when each piece is attractive alone. Record the selected fidelity target and any intentional exception in the feature brief.

The [Robux shop example](../ui/robux-shop/index.html) applies this by composing its treasure hero from the same SVG symbols used in cards, tabs and balance displays. Its earlier glossy rendered chest is retained as historical source, not the active style reference.

## A shared visual grammar within a game

| Decision       | Example default                              | Purpose                                  |
| -------------- | -------------------------------------------- | ---------------------------------------- |
| Main surfaces  | Ink `#101827`, raised `#1C293B`              | Low visual noise behind content          |
| Type           | Ivory `#F1F5F9`, secondary `#B4C0D3`         | Clear reading hierarchy                  |
| Action         | Mint `#8DE0BD`, dark ink label               | One obvious primary action               |
| Special detail | Brass `#E8BC74`                              | Sparse reward/material highlight         |
| Error          | Coral `#FFABA0` with explicit text           | Understandable without color alone       |
| Spacing        | 4, 8, 12, 16, 24, 32, 48                     | Repeatable rhythm                        |
| Corners        | 8 controls, 16 panels                        | Related silhouettes, restrained rounding |
| Type sizes     | 12 metadata, 16 body, 20 section, 28 title   | Few meaningful levels; scale for device  |
| Touch controls | At least 48 × 48 logical pixels              | Comfortable input; verify native size    |
| Motion         | 100 ms press, 160 ms selection, 240 ms panel | Fast response, readable transitions      |

These are art starting points, not engine performance limits or accessibility certification. Inspect contrast in final states; aim for 4.5:1 for ordinary text. Measure rendered native sizes and test localization expansion rather than assuming CSS pixels map exactly to Roblox offsets. Colors convey roles; an item's rarity must also have a word, shape or icon. Never spend the primary action color on unrelated decoration.

## Interface

Give each screen one dominant task and a clear reading order. Align related content and use space, surface contrast and borders deliberately to show grouping. Establish a small set of font roles; outlines, gradients and bevels are valid when they belong to the chosen style and preserve readable letterforms. Keep border weight, shadow direction, corner treatment and icon lighting consistent. Use icons from one family with consistent visual weight. Make the selected, hovered, pressed, focused, disabled and pending states distinguishable. Preserve controller focus and offer touch equivalents for hover information.

Dense screens need an attention budget. Identify the main action, progression information, navigation and optional promotions, then verify that secondary accents do not overwhelm the main task. Repeated upgrade rows should place icon, title, current/next values, level and price in predictable locations. Show locked, unaffordable, available and pending states with words or symbols as well as color. Do not scale an entire desktop HUD down to fit a phone: preserve the main action and reorganize supporting information into panels, tabs or drawers appropriate to the game.

Design empty, loading, error, full, long-name and maximum-value states. State what happened and how to recover. Keep currency values legible; distinguish price, balance and reward. Reserve room for translated text. Keep Roblox menus and device safe areas clear. Long lists need scrolling and an intentional selection policy. Do not let decorative animation delay input or hide essential feedback.

Follow concepts → editable HTML → TSX → native comparison as required by [architecture](../architecture.md#ui-workflow). The lab is a design source, not a native component library. Build shared runtime tokens/components when implementing a real screen; do not fork magic colors and timings across each panel.

## Modeling, materials and world composition

An object should read at gameplay distance as a silhouette, in flat gray, before surface detail. Choose a proportion rule (for example, broad bodies with small, deliberate bevels) and repeat it. Spend geometry on silhouette and deformation. Avoid evenly distributed tiny detail that becomes shimmer on a phone. Use purposeful asymmetry and one focal feature rather than a collection of unrelated motifs.

Keep a small material vocabulary: matte body, rough stone, satin painted metal, occasional emissive focal point. Establish scale, pivots, forward axis and applied transforms before export. Separate collision needs from render geometry. Test materials under the actual game's lighting, not only a flattering Blender render. Keep navigation and interactable silhouettes readable against the background. Reserve the strongest contrast and saturation for players, interactables and hazards.

Keep `.blend` scenes, recipes, source textures, rigs and exports traceable under durable `assets/`; use the existing [asset tools](../tooling.md). Set per-feature triangle, texture, material and draw-distance budgets after measuring representative target devices. A generic polygon count cannot substitute for profiling the assembled scene.

## Animation

Make the intention readable through anticipation, action and settle. Favor strong key poses and clear weight shifts; overlapping secondary motion should support the action. Start from a silhouette playblast. Review at actual gameplay camera distance, normal speed and slow speed. Check foot contact, sliding, intersections, loop seams, root motion, attachment alignment and cancel transitions. Proportional retargeting still needs contact review.

Document clip duration, loop mode, priority, blend times and named impact/release markers in the feature brief. Align VFX and SFX with those markers. Gameplay authority determines damage and rewards; a client animation marker is presentation timing, not permission to award anything. Include interruption, rapid repetition and unequip/despawn behavior. A reduced-motion option should suppress decorative overshoot, shake and travel while keeping state changes immediate and understandable.

## VFX and camera

Build an effect around an event and a readable silhouette: one leading shape, one accent layer, one short dissipating tail. Establish the impact timing in grayscale first. Use the shared palette with explicit exceptions for gameplay meaning. Keep the central action visible; avoid full-screen additive fog, persistent bloom and particles that hide hazards. Reserve large effects for rare, consequential events so ordinary hits have somewhere to escalate.

For every effect record lifetime, size, distance cutoff, emission cap, simultaneous-instance cap and low-quality fallback. Test many actors triggering it at once. Prefer a clear impact flash or ring over hundreds of unstructured particles. Suppress repeated effects when their cues would merge. Camera shake and flashes need intensity controls; reduced motion removes decorative shake and full-screen pulses. Clean up attachments, emitters, tweens and pooled instances on interruption and shutdown. A quality fallback must retain essential hazard information.

## SFX and music

Use one coherent sonic vocabulary: the example direction suggests dry tactile clicks, soft wood/metal contacts and short airy reward tones. Choose a few related sounds rather than a different timbre for every button. Give each cue a purpose: focus, confirmation, rejection, impact, reward or ambience. Routine hover/focus can be silent; successful selection should never trigger a reward fanfare.

Record source/license, asset permission, gain, pitch variation, duration, spatial range and voice cap in the brief. Audition in the mix at ordinary listening volume. Prioritize warning and action cues over ambience; test ten rapid repeats and several players together for clipping, harshness and masking. Cap voices, suppress redundant cues, and keep random pitch variation narrow enough to preserve identity. Expose independent music/SFX controls and remember their settings when persistence exists. Keep important information visible with audio muted. No default third-party sound IDs or unlicensed music belong in the template.

## Compose one feedback event

| Phase        | Example: equip an item                                                      | Why                                 |
| ------------ | --------------------------------------------------------------------------- | ----------------------------------- |
| Input        | Button responds immediately; pending state if server confirmation is needed | Input feels acknowledged            |
| Confirmation | Authoritative result updates item and action label                          | UI reflects actual state            |
| Accent       | 160 ms selection emphasis; optional short tactile click                     | Confirms without stealing attention |
| Settle       | Small status message; no persistent sparkle                                 | Returns attention to play           |
| Failure      | Keep selection; explain rejection and allow retry                           | Recoverable and truthful            |

VFX, SFX, UI and animation should describe the same event at the same moment. Do not play success presentation before a server-dependent action succeeds. Cancellation must stop or settle owned presentation work. Repetition should become quieter, not accumulate indefinitely.

## Review before calling it polished

1. Show the player task and focal point in a five-second capture. Check grayscale, gameplay distance and an uncluttered state.
2. Compare native screenshots with the selected reference at desktop, 360 × 740 portrait and 740 × 360 landscape. Exercise touch/controller focus and long content.
3. Capture normal, empty, pending, rejected, disabled and interrupted states. Check reduced motion, muted audio and the low-quality effect tier.
4. Record a representative crowded scene on the lowest supported device. Report device, resolution, actor count, effect count, frame time and observed spikes. Choose budgets against the game's target; do not invent a pass from an empty editor.
5. Review the combined feedback event with sound, then with sound muted. Check timing, mix, repeat behavior and cleanup.
6. Record exact source snapshot, captures, known gaps and approval decisions in the feature handoff. Builds prove compilation; HTML previews prove a concept; neither proves native visual or audio quality.

Reject a pass with unclear hierarchy, unreadable controls, mismatched materials, sliding contact, masked hazards or harsh repeated sound even if each asset looks attractive in isolation. Fix the highest-impact problem first. Stop adding detail when it competes with the player's next decision.
