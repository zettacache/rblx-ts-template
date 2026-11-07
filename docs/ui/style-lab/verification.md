# Browser review

Reviewed 2026-11-07 in local Chrome through the browser connector. Open `prototype.html` directly to use the specimen; it needs no install, build, server or network access. Evidence images are full-page captures at the listed viewport dimensions, not native Roblox captures.

| Viewport / case     | Result                                                                                                             | Evidence                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| 1440 × 900 desktop  | Two-column hierarchy, shared card alignment, legible inspector                                                     | [Desktop](evidence/desktop.jpg)      |
| 360 × 740 portrait  | Stacked inspector, two-card grid, scrolling; document width 345 including scrollbar exclusion, within 360 viewport | [Portrait](evidence/portrait.jpg)    |
| 360 × 740 empty     | Empty explanation, restore action, disabled equip                                                                  | [Empty](evidence/portrait-empty.jpg) |
| 740 × 360 landscape | Narrow two-column layout, page scrolls; document width 725, within 740 viewport                                    | [Landscape](evidence/landscape.jpg)  |

Verified by browser interaction: selecting Sunward, pending action with disabled controls, confirmed equip and moved badge; selecting Stonewake and rejecting an equip preserves Sunward's equipped badge and exposes retry text; empty/restore states; Enter activates an item; reduced-motion checkbox sets the motion class and computed transition duration to `0s`. No browser console warnings/errors were reported during this review. Minimum visible button height measured at least 48 px in portrait.

The optional oscillator is a timing sketch, initially muted. No production sound assets, mix approval or listening-quality claim. No Roblox TSX port, 3D asset, animation clip, uploaded content, native device performance measurement or Studio execution is included. Those remain acceptance work for game features adopting this reference. This reference defines direction and a review method; it does not make future games automatically polished.
