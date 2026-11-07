# Crafted adventure style lab

Player task: compare three equipment items, inspect one and equip it. This is a fictional, browser-only design specimen, not new template gameplay or a connected inventory.

Concepts considered:

1. Bright arcade: saturated tiles, heavy outlines and oversized reward bursts. Strong energy, but too prescriptive for a general starter.
2. Glass science fiction: translucent panels and luminous fine lines. Requires careful scene contrast and gives the template a narrow genre identity.
3. Crafted adventure (selected): ink surfaces, ivory typography, mineral mint actions, brass details, faceted object silhouettes. Extends the loading screen's palette while giving assets room to carry personality.

Reading order: collection title → item silhouettes and selection → item name/description → primary action. A warm landscape strip supplies context without a background image. Items share a designed shield silhouette with different material/color roles. No emoji or external fonts/images are required. CSS geometry stands in for authored models; it is not an exportable 3D asset.

The prototype has selectable items, an equip action, pending and rejected demonstrations, an empty-state toggle, reduced-motion control and optional synthesized sound. Audio is off until explicitly enabled; browser tones demonstrate cue timing only and are not proposed production SFX. The feedback sample uses a bounded CSS ring and sparks, with a reduced-motion fallback. A successful action updates the equipped tag and status. A failed action preserves the previous equipped item.

Layout: two columns on desktop, stacked at 720 px and below, two-card grid at narrow widths. Minimum 48 px controls. The page scrolls on short landscape displays. The inspector comes after the collection in reading and keyboard order. Test at 1440 × 900, 360 × 740 and 740 × 360; preview all states and check overflow. Keyboard focus, status announcements and text rarity labels accompany visual states.

Port plan when a game adopts this screen: map layout to native frames/UIGridLayout/UISizeConstraint; map CSS typography to a chosen Roblox Font; use authored viewport models or owned images for objects; use a presentation state owner for pending/selection, and confirmed replicated inventory for equipment. Map rings to a capped effect with destruction on unmount. Provide native controller selection/focus and safe insets. Browser audio and CSS animation are illustrative; native sound mixing, engine performance and Studio appearance require separate acceptance. This task changes design guidance and examples only, with no TSX port or runtime claim.
