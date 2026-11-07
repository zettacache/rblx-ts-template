# Robux shop — Treasure Market

Player task: understand what an offer contains, distinguish permanent perks from consumables, compare the Robux price and decide whether to continue to a purchase prompt.

Directions considered: a restrained catalog with fine borders; a dense arcade grid like UI-001; a focused arcade market with one illustrated hero and three supporting cards. Selected the last: it retains the reference's chunky navy contours, consistent icon lighting and raised green price controls, with fewer competing attention cues.

Style contract: playful, substantial, inviting. Exclude fake urgency, unrelated icon styles and indistinguishable product durations. Cobalt frame, navy contours, cream surfaces, gold hero, mint-green purchase buttons. Bold rounded display roles, smaller readable body copy, consistent lower shadows and broad corners. Every price uses the same Robux symbol and numeric hierarchy. Robux prices are fictional design examples, not published product data or balance recommendations.

Desktop reading order: shop title/close → categories → Starter Bundle → permanent perk and boost cards → demo information. A fictional coin/gem balance is separated from Robux product prices. Categories filter the catalog; each card keeps its name, duration/type, benefit and price in stable positions. On portrait the hero art sits above content and products stack; category controls wrap rather than shrinking text. Short landscape layouts scroll. Controls are at least 48 px high and keyboard focus remains clear.

States: default, selected category, purchase review, simulated pending/success/cancel, owned one-time product, repeated consumable, closed/reopened shop. Review dialog states exact contents, price and purchase type; confirmation is explicitly simulated. No Roblox account, MarketplaceService, product ID or payment integration. Production would use platform prompts and server-verified fulfillment; this prototype grants only local demo state. Rejection/retry and real fulfillment states require a separate runtime implementation. No claim of native UI acceptance.

Artwork: original generated transparent treasure bundle, saved locally with its prompt in artwork.md. Small coin/gem/crown/potion symbols use an editable SVG family; no source screenshot icons are extracted. The large image is decorative beside text describing every included item. Motion is a brief control press/entry response; OS reduced motion is honored. No autoplay sound or flashing reward loop.

Sources: docs/art-direction/README.md and UI-001 reference analysis. This design demonstrates one arcade identity, not a template-wide shop skin. Runtime porting and real pricing are outside the requested design presentation.
