## 2026-02-20 - Stage 1 foundation scaffold completed
- Replaced Vite starter UI with full-screen app shell containing only global controls: start overlay, next-scene button, and fade layer.
- Implemented `ThreeApp` WebGPU bootstrap (`three/webgpu`) with renderer init checks, shared baseline lighting, starfield backdrop, resize handling, and animation loop.
- Added pointer-lock inspect controls in `src/three/controls/PointerLookControls.js` with mouse look + `WASD` movement relative to current camera direction.
- Added strict scene lifecycle pipeline via `SceneManager` and per-scene lifecycle contract (`init`, `update`, `resize`, `dispose`).
- Added shared cleanup utilities in `src/three/utils/dispose.js` for geometries/materials/textures and safe scene unload.
- Added 13 placeholder scene modules in `src/three/scenes/` mapped to planned chronology, each with distinct geometry/animation for easy load validation.
- Scene order is centralized in `src/three/scenes/sceneManifest.js`.
- Validation: `npm run lint` passes, `npm run build` passes (bundle size warning only).
## 2026-02-20 - UI upgrade + navigation controls + simplified placeholders
- Reworked entrance UI from a basic modal to a themed cinematic overlay with premium styling, gradient treatment, and typography hierarchy.
- Added persistent scene HUD and upgraded control panel styling to match the visual theme.
- Added scene navigation behavior:
  - First scene: `Next Scene` only.
  - Scene index > 0: both `Previous Scene` and `Next Scene` buttons (next disables on last scene).
- Added collapsible left-side scene navigator (default collapsed) with direct jump to any scene.
- Extended navigation pipeline with `goToPreviousScene()` and `goToScene(index)` in `ThreeApp`, backed by `previous()` and `goTo(index)` in `SceneManager`.
- Simplified all placeholders to a single rotating cube per scene file using a streamlined placeholder factory.
- Validation: `npm run lint` passes, `npm run build` passes.
## 2026-02-20 - Start UI image integration
- Preserved user-edited start copy in `src/App.jsx` and added branded entrance artwork (`/logo-tp.png`) directly into the start panel.
- Updated start-layout styling to a responsive two-column composition on desktop and stacked composition on mobile.
- Validation: `npm run lint` passes, `npm run build` passes.
- Refined entrance composition to prevent title/logo overlap and removed framing styles around logo artwork so it sits naturally without a white boxed border effect.
- Shifted entrance logo further right and increased text-block right gutter to eliminate title/logo overlap on desktop; mobile keeps centered logo with no offset.
- Removed manual `navigator.gpu` gating; renderer now attempts WebGPU init in all browsers and reports unsupported state only when init fails.
- Boot error UI now labels WebGPU capability failures as `WebGPU Unsupported` with a clear user-facing message.
- Start transition now snaps to full black first, then fades into first scene to avoid visible scene flash before fade.
- Updated `.codex/build_scenes.md` Scene-by-Scene Build Map: replaced all 13 short `Build here` prompts with detailed cinematic visual descriptions for Stage 2 implementation guidance.

# Start Building Scenes

