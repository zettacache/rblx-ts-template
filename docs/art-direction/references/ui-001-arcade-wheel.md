# UI-001 — arcade wheel and upgrade HUD

Source: user-supplied screenshot received 2026-11-07. Game, creator and capture device are not identified. The user requested learning from references while keeping template output stylistically diverse. They did not identify individual details as preferences. [Source image](ui-001-arcade-wheel.png).

## What is visible

The screenshot uses a bright blue environment behind a large central reward wheel. Tall upgrade panels frame the wheel on the left and right. A wide SPIN control anchors its lower edge. Currency, multipliers, navigation and offers occupy the upper perimeter. The central object remains recognizable despite dense surrounding information.

Components share dark navy outlines, rounded corners, directional highlights and lower shadows that create a raised, toy-like depth. Cream upgrade rows sit inside blue containers. Bold rounded lettering, often outlined, separates labels and numbers from saturated surfaces. Large object icons have readable silhouettes and a related glossy treatment. Fire, snowball, money, stopwatch and luck icons provide distinct category cues.

Upgrade rows repeat an anatomy: icon at left, title and a short benefit/comparison in the middle, level and price at right. Several show a current value, an arrow and a next value. A next-goal strip combines an action name, progress amount and goal count. Levels, prices, locks and small progress bars supplement color. Bright green price panels and darker expensive/locked-looking panels differ visually, but their precise interaction rules are unknown.

Pink NEW, offer and notification marks compete with yellow/orange highlights and green purchase controls. Lower list content is clipped by the scroll regions, with a visible scrollbar on the left. The screenshot captures one populated landscape state only.

## Interpretation and transferable lessons

| Observation                                      | Inferred benefit                                         | Adopt as a principle                                      |
| ------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------- |
| Repeated row positions and proportions           | Players can compare upgrades without relearning each row | Define component anatomy and align comparable values      |
| Current → next values beside a price             | Consequence and cost can be assessed together            | Make choices legible before confirmation                  |
| Thick dark contours and opaque panels            | Content separates from a bright, detailed world          | Test foreground separation against actual scenes          |
| Related icon silhouettes, highlights and shadows | The interface feels authored as a set                    | Specify a shared icon/material/depth language             |
| Central wheel plus large bottom action           | Spatial composition emphasizes the core loop             | Give the main object and next action a deliberate anchor  |
| Goal progress with a named next purchase         | A near-term objective is made concrete                   | Connect progression status to an understandable next step |

These are design inferences, not measured usability or retention findings. They should be tested in the target game.

## Style-specific choices

Saturated blue/green/yellow, thick navy strokes, chunky display type, cartoon gloss, raised buttons, diagonal badges and dense sidebars form this reference's arcade identity. None becomes a template-wide requirement. For this style, refining an outline hierarchy or icon highlight consistency is more appropriate than removing all decoration. For a different game, the same hierarchy and component discipline can use a completely different palette, typography and surface treatment.

## Tradeoffs to examine, not copy automatically

- Many simultaneous attention cues reduce the difference between routine actions, navigation, new content and offers. Assign emphasis by player priority, and review which notices need to be visible together.
- The main action is large, but surrounding rows and top controls remain visually forceful. Check a five-second glance and grayscale capture for the intended reading order rather than assuming size alone solves hierarchy.
- Current/next values are useful, but labels, units, number formatting and unavailable-state explanations still need deliberate rules. Preserve those on long names, large values and translated strings.
- The dense landscape framing needs a separate touch/portrait composition. This screenshot cannot establish that small controls, clipped content or scroll behavior work on phones.
- Decorative outlines must preserve counters and spacing inside letters at the smallest native size. Gloss and gradients must retain readable label contrast in every state.

## Unknown from this image

Animation timing, hover/press/focus states, controller selection, audio, reduced motion, server confirmation behavior, purchase handling, empty/error states, mobile layouts and performance are unverified. No SFX, VFX or animation prescription is derived from a still image. Request or review clips when those disciplines become relevant.

## Changes to template direction

The guide now explicitly separates quality principles from their stylistic expression. It allows rich outlined arcade UI alongside restrained styles, requires a project-specific style contract, adds repeated upgrade anatomy and attention-budget guidance, and asks feature briefs to distinguish observations from inferences. The existing crafted-adventure lab remains one worked example; it has not been reskinned to imitate this screenshot. Future references can broaden or revise these findings.
