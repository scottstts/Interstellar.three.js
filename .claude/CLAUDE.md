# Context
We are building a cinematic, non-game React + Vite app that recreates iconic scenes from the movie *Interstellar* using Three.js with WebGPU.

The experience is a chronological sequence of 10-15 recognizable scene recreations. App flow is:
1. Start screen
2. User clicks Play
3. One scene plays at a time
4. User clicks Next Scene to advance
5. Transition between scenes uses a simple black fade-out/fade-in

Interaction model:
- No gameplay systems
- No scene-local UI, tooltips, or informational overlays
- UI is globally controlled only (start and next controls)
- Camera is inspectable by the user at all angles with mouse look + `WASD` movement relative to current view direction

Architecture direction:
- Every scene lives in its own modular file so scenes can be edited and maintained independently
- Stage 1 focuses on app structure and placeholder scenes
- Stage 2 focuses on replacing placeholders with high-recognition scene recreations

# Plan

Refer to dev_docs/plan.md for general main stages of implementation. Refer to dev_docs/build_scenes.md for specific instructions for building out each scene.

# Skills

Use three.js WebGPU Agent Skills when needed

# Rules

1. if there are ambiguities or issues during building that you can't solve or you need to clarify, stop the job and ask me and report issues so i can help you (like installing packages, look for assets, etc.). DO NOT fall back to any inferior choices without asking me first!
2. run lint and build every time you finish a coding task to make sure code is clean
3. I will run dev myself to inspect the in-game play, no need for `npm run dev`
4. Use WebGPU instead of WebGL throughout the build