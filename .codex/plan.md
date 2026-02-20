# Interstellar Scene Recreation Plan

## Chronological Scene List (Draft: 13 Scenes)
1. Cooper farmhouse and cornfield world intro
2. Dust storm and the gravitational anomaly in Murph's room
3. Cornfield drone chase and retrieval
4. Secret NASA facility reveal and mission briefing
5. Endurance launch from Earth
6. Endurance travel near Saturn before wormhole entry
7. Wormhole crossing sequence
8. Miller's planet shallow-water landing and giant wave approach
9. Dr. Mann's ice planet landing zone
10. Endurance spin-docking emergency maneuver
11. Slingshot around Gargantua
12. Tesseract bookshelf space-time sequence
13. Cooper Station reunion with elderly Murph

## Stage 1: App Foundation and Placeholder Scene Pipeline
Goal: Build the full app flow and technical framework so all scenes can play sequentially, while scene modules remain placeholders.

### Deliverables
- React app shell with global start/play and next-scene controls
- Scene sequencer that loads one scene module at a time in fixed order
- Black fade-out/fade-in transition between scene changes
- Navigable camera controls (mouse look + `WASD`) with movement always relative to current camera direction
- Modular scene folder structure with one placeholder file per scene
- Scene lifecycle standard (`init`, `update`, `resize`, `dispose`) shared by all modules
- No scene-local UI elements

### Implementation Plan
1. Create core rendering architecture:
   - `ThreeApp` bootstrap service for renderer, camera, clock, resize handling, animation loop
   - WebGPU-first renderer setup and capability checks
   - Shared lighting/environment baseline for placeholder rendering
2. Define a strict scene module contract:
   - Standard exports for metadata + lifecycle methods
   - Consistent way to register per-scene animation callbacks
   - Reliable cleanup path for geometries, materials, textures, and listeners
3. Build scene registry and sequencing:
   - Ordered scene manifest
   - Scene manager to unload current module and load next
   - Simple global state for `idle`, `playing`, and `transitioning`
4. Build global UI layer:
   - Start overlay
   - Next Scene button
   - Fullscreen fade layer for transitions
   - Keep UI isolated from scene files
5. Implement camera/navigation system:
   - Pointer-lock mouse look
   - `WASD` directional movement based on camera orientation vectors
   - Tunable movement speed and sensitivity defaults
6. Create placeholder scene modules:
   - One file per scene in sequence order
   - Each placeholder has unique composition so module loading is easy to validate
   - Each module follows the shared lifecycle contract
7. Verify developer baseline:
   - Run lint/build and fix issues
   - Confirm scene switching, transitions, resize behavior, and memory cleanup

### Stage 1 Definition of Done
- All planned scene modules exist as separate files and load correctly
- Start -> play -> next sequence works end-to-end
- Fade transition works on every scene change
- Camera inspect controls function consistently across all scenes
- No scene-specific UI appears on screen
- Lint and production build pass

## Stage 2: Individual Scene Production
Goal: Replace each placeholder with a recognizable cinematic recreation while preserving the Stage 1 framework.

### Per-Scene Workflow (Repeat for each module)
1. Visual target definition:
   - Lock composition, camera framing options, mood, and key props
   - Identify recognition anchors that make the scene instantly identifiable
2. Scene blockout:
   - Build large forms and world scale first
   - Validate camera readability from multiple inspect angles
3. Asset/detail pass:
   - Add medium/small environmental details
   - Introduce set dressing relevant to scene identity
4. Lighting/material pass:
   - Match color temperature, contrast, and atmospheric depth
   - Refine surfaces for cinematic clarity
5. Motion pass:
   - Add ambient animation loops and timed events
   - Keep behavior deterministic and stable at variable frame rates
6. Optimization pass:
   - Budget geometry/material/texture complexity
   - Reduce draw calls and overdraw where practical
7. Validation pass:
   - Recognition check: instantly readable without UI text
   - Transition in/out quality check with neighboring modules

### Final Integration and Polish
1. Normalize scene-level technical standards:
   - Shared camera movement feel across modules
   - Stable performance envelope scene-to-scene
2. Sequence-level quality pass:
   - Verify chronological continuity and pacing
   - Tune fade timing and scene handoff rhythm
3. Release readiness:
   - Run lint/build and address warnings/errors
   - Update implementation notes in `notes/notes.md`
