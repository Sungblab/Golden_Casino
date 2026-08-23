# Golden Casino Platform Prototype — Design QA

## Comparison target

- Source visual truth: `C:\Users\Sungbin\Documents\GitHub\Golden_Casino\golden_casino_frontend\user.html`
- Source capture: `C:\Users\Sungbin\.codex\visualizations\2026\08\08\019fe140-d271-72d2-a923-6f258ed820cd\golden-legacy-user-source.png`
- Implementation: `C:\Users\Sungbin\Documents\GitHub\Golden_Casino\golden_casino_frontend\platform-prototype.html`
- Lobby capture: `C:\Users\Sungbin\.codex\visualizations\2026\08\08\019fe140-d271-72d2-a923-6f258ed820cd\golden-platform-lobby-compare.png`
- Baccarat focused capture: `C:\Users\Sungbin\.codex\visualizations\2026\08\08\019fe140-d271-72d2-a923-6f258ed820cd\golden-platform-baccarat-table.png`
- Blackjack focused capture: `C:\Users\Sungbin\.codex\visualizations\2026\08\08\019fe140-d271-72d2-a923-6f258ed820cd\golden-platform-blackjack-table.png`
- Mobile capture: `C:\Users\Sungbin\.codex\visualizations\2026\08\08\019fe140-d271-72d2-a923-6f258ed820cd\golden-platform-lobby-mobile-viewport.png`

The source is a legacy baccarat-only game screen, while the implementation adds a new lobby and blackjack. It is therefore the visual-style truth rather than a one-to-one lobby layout specification. The focused baccarat comparison is the closest shared state.

## Capture normalization

- Desktop CSS viewport: 1280 × 720, dark theme, browser-rendered, `devicePixelRatio: 2` reported by the in-app browser.
- Source pixels: 1280 × 720.
- Lobby implementation pixels: 1265 × 712 after the browser excluded native scrollbar chrome; compared at the same CSS viewport without upscaling.
- Focused baccarat implementation pixels: 1265 × 712 at the same CSS viewport and density.
- Mobile CSS viewport: 390 × 844; captured content pixels: 375 × 812 after native scrollbar/browser exclusions.
- States: source baccarat idle; implementation lobby idle; focused implementation baccarat betting phase; mobile lobby idle.

## Findings

No actionable P0, P1, or P2 findings remain.

### Required fidelity surfaces

- Fonts and typography: the implementation keeps the source's Korean serif-led casino identity with Noto Serif KR for display/table labels and adds Noto Sans KR for denser application UI. Gold display hierarchy, compact uppercase labels, wrapping, and small-text weights remain legible at desktop and mobile sizes.
- Spacing and layout rhythm: the legacy centered black canvas, thin gold rules, green table surface, and compact bet controls are preserved. The new lobby uses the same restrained border and radius language rather than introducing a disconnected dashboard style. Desktop grids collapse to single-column mobile cards without overlap.
- Colors and visual tokens: black, antique gold, dark felt green, Player blue, Banker red, and Tie green map directly to the source. Disabled states and secondary panels remain subdued and do not compete with betting targets.
- Image quality and asset fidelity: real playing-card image assets are used for lobby and dealt cards; Font Awesome supplies interface icons. No custom SVG or generated substitute replaces a source asset. The initial empty-card CSS placeholder was removed in the second pass.
- Copy and content: game, table-limit, phase, wallet, and action copy is coherent as a standalone post-login casino flow. Prototype-only values are explicitly labelled in the session panel.
- Accessibility and states: semantic buttons, visible focus styling, reduced-motion support, disabled action states, mobile tap targets, and labelled regions are present. No horizontal page overflow was observed at 390 px.

## Full-view comparison evidence

- Source and implementation were opened together at the same desktop CSS viewport.
- The implementation retains the source's black/gold identity, serif title treatment, gold-framed dark surfaces, green felt, and semantic betting colors while extending the information architecture to a multi-game lobby.
- The lobby intentionally increases whitespace and hierarchy because it must support game selection and multiple rooms; this is classified as an expected product extension, not visual drift.

## Focused comparison evidence

- The legacy baccarat and new automated baccarat table were compared together at 1280 × 720 CSS.
- Player, Banker, and Tie controls preserve the established blue/red/green mapping and gold-framed table treatment.
- The new table adds pair bets, phase/timer, scoreboard, and session summary without changing the recognizable Golden Casino art direction.

## Comparison history

### Pass 1

- [P2] Mobile brand text clipped at 390 px. Fixed by removing the artificial width cap, reducing mobile brand type slightly, and tightening header spacing.
- [P2] The mobile “게임 선택” heading wrapped awkwardly beside its explanatory text. Fixed by stacking the section heading and description below 760 px.
- [P2] Empty card slots used visible dashed placeholder boxes. Fixed by removing the border/background while keeping layout space for dealt cards.

### Pass 2

- Re-captured the 390 × 844 mobile lobby. Brand width equals its scroll width, the section heading stacks cleanly, and no horizontal overflow remains.
- Re-captured the 1280 × 720 baccarat table. Empty placeholders are no longer visible and the felt area matches the source's uncluttered surface.
- No remaining actionable P0/P1/P2 differences were found.

## Functional verification

- Lobby → Baccarat rooms → Rookie Baccarat table.
- Baccarat chip selection and Player bet deducted 1 coin; the round advanced from `#1003` to `#1004` automatically and returned to betting.
- Lobby → Blackjack rooms → Rookie Blackjack table.
- Blackjack chip bet deducted 1 coin; initial deal produced two player cards; Hit produced a third card; Stand completed dealer resolution and displayed a result.
- Room limits, active/waiting labels, scoreboard, wallet drawer controls, disabled betting/action states, and responsive layout were rendered.
- Inline JavaScript syntax check passed; duplicate HTML ids were not found.
- Browser console warnings/errors on the implementation: none.

## Follow-up polish

- [P3] A production build should self-host fonts, icons, and card images or provide local fallbacks so the table remains visually complete offline.
- [P3] Real player counts, roadmaps, wallet totals, and room status should replace prototype data when the React/API phase begins.

## Implementation checklist

- [x] Preserve Golden Casino visual identity.
- [x] Add game lobby and limit-based room selection.
- [x] Add automated baccarat interaction loop.
- [x] Add blackjack seat, bet, and action loop.
- [x] Verify desktop, mobile, core interactions, syntax, and console.

final result: passed
