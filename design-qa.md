# Design QA

- Source visual truth: `design-source-mantle-landing.png`
- Implementation screenshot: `design-implementation-builder.png`
- Side-by-side comparison: `design-comparison.png`
- Viewport: 1280 × 720 CSS px at 1× density
- Source pixels: 1280 × 720
- Implementation pixels: 1280 × 720
- State: dark theme, empty project

## Full-view comparison

The Builder preserves its task-specific navbar and empty-project content while matching the Mantle Landing's navy/teal palette, glass elevation, dark atmospheric background, and compact brand treatment. The Builder is intentionally darker than the source per the follow-up request.

## Focused region comparison

The full-view capture keeps the navbar, glass surface, typography, form control, CTA, and background treatment legible at 1×, so no additional crop was needed.

## Required fidelity surfaces

- Fonts and typography: Geist remains the existing shadcn application font; hierarchy, weight, line height, wrapping, and small-label tracking are consistent with the source's product-sans treatment.
- Spacing and layout: centered single-purpose glass panel, generous negative space, 16 px radii, compact navbar, and responsive mobile layout match the source rhythm.
- Colors and tokens: Mantle navy, primary blue, teal, and mint values are mapped into shadcn semantic tokens; dark mode uses a solid `#01040d` base instead of a dimming overlay.
- Image and asset fidelity: the supplied Mantle mark and original MIT Night Tide fluid asset are reused; no substitute illustration or Kiwa asset is present.
- Copy and content: the empty state names Mantle directly, explains the product in plain language, and keeps the technical contract in the copied agent prompt.

## Interaction evidence

- Theme toggle switches between dark and light and persists the chosen theme.
- Night Tide initializes only in dark mode and responds to pointer movement.
- Light mode removes the canvas-ready state.
- Empty-project textarea and copy control remain exposed and legible.
- WebMCP tools register successfully.
- Browser console: no warnings or errors after the final reload.

## Comparison history

- Initial implementation used a source-code dynamic import for a public asset; Vite rejected it.
- The loader moved to a native public module tag and the redundant React loader was deleted.
- The loader now waits for React to mount the canvas, removing an intermittent first-load race.
- Dark tokens were reduced in luminance without dimming the animated layer; Night Tide remains at 0.4 opacity.
- The navbar and empty-project card use translucent surfaces with native backdrop blur over that higher-contrast base.
- Final matched screenshots show no remaining P0/P1/P2 issue.

final result: passed
