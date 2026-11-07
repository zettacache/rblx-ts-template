# Session counter reference

Player task: press Add one and see the server-confirmed session count. This is an optional teaching feature, not an economy or persistent reward.

Selected direction: a quiet navy card at top center, mint action, large count, and one status line. A centered modal was rejected because it would obstruct movement. The original bottom position was rejected after native portrait captures showed overlap with Roblox movement controls. Reading order: title, count, status, action. Keep a 48px action target, 16px screen margins and a 360px maximum card width. Desktop, portrait and landscape share the same card; Roblox safe insets and the top position keep it clear of system controls.

States: connecting (disabled), ready, pending (disabled), retry after two seconds, and session cap reached (disabled). Never increment optimistically. Keyboard/gamepad selection uses native button activation; touch and mouse use the same action. No images, external fonts, sound or animation assets are required.

Editable reference: prototype.html. Preview its query-string states with ?state=connecting, pending, retry or capped. Runtime equivalent: src/client/reference-counter.tsx. Native text metrics and safe insets may differ; compare desktop, portrait and landscape captures before accepting the port.
