# Stage 2 Scene Build Guide

## Purpose
Use this file as the implementation contract for replacing scene placeholder cubes with full cinematic scene builds. Anything within the scene files are subject to your changes.

## What Is Already In Place
The app foundation is complete and should stay stable while scenes are built (Don't touch these):

- Global app shell + themed entrance UI + scene HUD/navigation: `src/App.jsx`, `src/App.css`
- WebGPU renderer bootstrap and render loop: `src/three/ThreeApp.js`
- Scene lifecycle loading/unloading and sequencing: `src/three/SceneManager.js`
- Camera inspect controls (pointer-lock + `WASD`): `src/three/controls/PointerLookControls.js`
- Scene order registry: `src/three/scenes/sceneManifest.js`
- Cleanup utilities for scene teardown: `src/three/utils/dispose.js`
- Transition behavior (black fade): handled globally in `src/App.jsx`

## Scene Build Boundary
For normal scene production, only edit scene modules under:

- `src/three/scenes/01CooperFarmhouseScene.js`
- `src/three/scenes/02DustStormMurphScene.js`
- `src/three/scenes/03CornfieldDroneScene.js`
- `src/three/scenes/04NasaFacilityScene.js`
- `src/three/scenes/05EnduranceLaunchScene.js`
- `src/three/scenes/06SaturnApproachScene.js`
- `src/three/scenes/07WormholeScene.js`
- `src/three/scenes/08MillersPlanetScene.js`
- `src/three/scenes/09MannsPlanetScene.js`
- `src/three/scenes/10SpinDockingScene.js`
- `src/three/scenes/11GargantuaSlingshotScene.js`
- `src/three/scenes/12TesseractScene.js`
- `src/three/scenes/13CooperStationScene.js`

## Scene Module Contract (Must Keep)
Each scene module must continue to export a scene definition compatible with current lifecycle usage in `SceneManager`:

- `init({ root, camera, renderer, scene })`
- `update({ delta, elapsed, root, camera, renderer, scene })`
- `resize({ width, height, root, camera, renderer, scene })`
- `dispose({ root, camera, renderer, scene })`

Rules:

- Add all scene objects under the provided `root` group.
- Do all per-frame animation inside `update`.
- Release all geometries/materials/textures/listeners in `dispose`.
- Do not add scene-local React UI.

## Where To Put Scene Assets
Use this convention for external assets (textures/models/hdrs):

- `public/assets/scenes/01/`
- `public/assets/scenes/02/`
- ...
- `public/assets/scenes/13/`

Keep scene JS modules loading only their own scene assets where possible.

If you need some asset for a specific scene build, let me know and I'll prepare it for you

## Scene-by-Scene Build Map

Rely on these scene descritpions as baselines for the scene recreation, but also use your own knowledge and understanding of the original movie scenes.

Each scene should have as much details as possible to create the original movie scenes. Use primitive objects for basic scene construction, use advance objects for details, use lighting and materials to stay true to the original movie vibe. Use animations to make the scene vivid and alive, but also to create motions in the scene when the scene is not fully static (such as when Cooper was docking Lander 2 with the exploded Endurance mid spinning)

The ultimate goal is to recreate the scene in a stylized way that is true to the original movie scenes, and have a good level of realism.

### 1) Cooper farmhouse and cornfield intro
- File: `src/three/scenes/01CooperFarmhouseScene.js`
- Build here: The opening introduces a visually grounded, dust-drenched near-future framed by sprawling, golden-brown cornfields that stretch endlessly toward a hazy, pale sky. Cooper's weathered, two-story farmhouse stands as a lonely beacon of mid-century Americana, its peeling white paint and rustic interiors steeped in a melancholic, nostalgic warmth. The cinematography relies heavily on natural, sunlit tones and wide, sweeping shots of Cooper's pickup truck kicking up dry dirt, establishing an idyllic yet arid atmosphere that grounds the viewer in the tactile reality of a slowly dying Earth before the cosmic journey begins.

### 2) Dust storm + Murph room anomaly
- File: `src/three/scenes/02DustStormMurphScene.js`
- Build here: An imposing, towering wall of thick brown dust - a massive haboob - swallows the farmhouse, plunging the exterior into a murky, suffocating twilight. Inside, the visual focus tightens to Murph's dimly lit bedroom, where ambient light filters through a poorly sealed window, illuminating swirling airborne particulate matter. As Cooper and Murph shine their flashlights across the floor, the chaotic flying dust abruptly settles into eerily pristine, thick, parallel lines of dirt, creating a striking, highly textured visual of the gravitational anomaly against the rustic, heavily shadowed wooden floorboards.

### 3) Cornfield drone chase
- File: `src/three/scenes/03CornfieldDroneScene.js`
- Build here: A kinetic, high-speed tracking shot captures Cooper's pickup truck violently plowing through a dense sea of tall, sunlit cornstalks, violently snapping the vibrant green and yellow vegetation under its heavy tires. Above them, a sleek, solar-paneled Indian surveillance drone cuts a smooth, silent path across a starkly clear blue sky, its pristine aerodynamic design clashing visually with the rugged, dusty farm truck below. The chaotic, bumpy interior shots of Cooper frantically steering while Murph operates a makeshift antenna culminate in the elegant machine gracefully descending into the dusty soil, seamlessly merging high-tech aerospace design with the agrarian landscape.

### 4) Secret NASA facility reveal
- File: `src/three/scenes/04NasaFacilityScene.js`
- Build here: The transition from the rural outdoors to the secret NASA facility is marked by a sudden shift to stark, cold industrial visuals, beginning with blinding nighttime floodlights and heavily shadowed, concrete interrogation rooms. The visual scale expands dramatically when Cooper is led into a cavernous, subterranean hangar bathed in crisp, sterile white light, revealing the massive, metallic rings of the Endurance centrifuge and the sleek, angular hull of a Ranger spacecraft under construction. The geometry of the scene is dominated by towering steel scaffolding, metallic catwalks, and pristine white spacesuits, creating an atmosphere of clinical, high-tech desperation hidden deep beneath the Earth's surface.

### 5) Endurance launch
- File: `src/three/scenes/05EnduranceLaunchScene.js`
- Build here: The launch sequence is depicted with violent, rattling interior camera shots that physically convey the extreme g-forces, contrasting sharply with wide, awe-inspiring exterior views of the massive multi-stage rocket tearing through the atmosphere on a blinding pillar of orange fire. As the rocket sheds chunks of white frost and metallic staging panels against the thinning blue stratosphere, the chaotic shaking abruptly transitions into the smooth, pitch-black, absolute silence of space. The sequence resolves beautifully as the sleek, angular Ranger perfectly matches rotation with the majestic, slowly spinning ring of the Endurance spacecraft, framed beautifully against the bright, curved horizon of the blue Earth.

### 6) Endurance near Saturn
- File: `src/three/scenes/06SaturnApproachScene.js`
- Build here: In one of the film's most breathtaking displays of scale, the circular Endurance is rendered as an impossibly tiny, fragile speck of metal drifting against the colossal, curving backdrop of Saturn. The gas giant dominates the screen in muted, majestic hues of pale gold, ochre, and soft white, with its vast, perfectly illuminated rings casting impossibly sharp, dramatic black shadows across the planet's atmospheric bands. The stark, silent composition emphasizes the crushing isolation and terrifying vastness of the solar system, utilizing deep blacks and brilliant, reflected sunlight to highlight the sheer physical insignificance of the human vessel.

### 7) Wormhole crossing
- File: `src/three/scenes/07WormholeScene.js`
- Build here: The wormhole initially appears as a flawless, glass-like spherical anomaly suspended in the blackness of space, acting as a profound gravitational lens that beautifully distorts and wraps the distant, shimmering starlight of another galaxy around its curved surface. As the Endurance breaches the event horizon, the visuals explode into a kaleidoscopic, violently shaking tunnel of warped, shifting geometry. Flashes of blinding white and golden energy streak rapidly past the viewport, creating a dizzying, highly textured corridor of bent space-time that visually simulates the tearing and folding of the universe itself.

### 8) Miller's planet wave approach
- File: `src/three/scenes/08MillersPlanetScene.js`
- Build here: The Ranger touches down in a visually boundless, knee-deep expanse of translucent, shimmering water that perfectly mirrors an overcast, pale-grey alien sky, creating a disorienting, horizonless optical illusion. This serene visual is shattered by a terrifying shift in perspective when distant, jagged grey "mountains" in the background are revealed to be an approaching, apocalyptic tidal wave of unfathomable height. The cinematography emphasizes the towering, vertical wall of dark, churning water as it rapidly eclipses the sky and blocks out the sunlight, dwarfing the tiny, fragile spacecraft and the frantically scrambling crew in a masterclass of terrifying scale.

### 9) Dr. Mann's ice planet
- File: `src/three/scenes/09MannsPlanetScene.js`
- Build here: Dr. Mann's world is a stark, desolate landscape composed entirely of fractured, jagged glaciers and unforgiving pale rock, enveloped in a sterile, icy blue and blinding white color palette. The visuals are defined by their harsh, jagged geometry, featuring bizarre, frozen clouds that cling to the rigid terrain like solid, suspended structures rather than vapor. The environment feels incredibly cold and claustrophobic despite being outdoors, with Mann's weathered, foil-wrapped hibernation pod resting like a metallic tomb amidst the sprawling, fractured ice formations under a weak, distant sun.

### 10) Endurance spin-docking
- File: `src/three/scenes/10SpinDockingScene.js`
- Build here: Set against the striking backdrop of the ice planet's curved white stratosphere and the pitch-black void of space, the shattered, flaming Endurance spins wildly out of control, trailing white gas and sparking debris. The scene is a masterwork of kinetic cinematography, utilizing cameras mounted directly to the hull of the Ranger to visually lock the spinning, damaged station in the center of the frame while the universe seemingly revolves around it at a dizzying, nauseating speed. The visual tension peaks as the sleek nose of the Ranger desperately inches toward the rapidly rotating docking hub, bathed in harsh, flashing sunlight and the violent shadows of flying shrapnel.

### 11) Slingshot around Gargantua
- File: `src/three/scenes/11GargantuaSlingshotScene.js`
- Build here: Gargantua is visualized as an awe-inspiring, terrifyingly beautiful sphere of absolute, light-devouring blackness, bisected and haloed by a fiercely glowing, hyper-luminous accretion disk of golden and fiery orange plasma. The physics-accurate rendering beautifully warps and bends the glowing bands of light over the top and bottom of the void due to extreme gravitational lensing, creating a mesmerizing, three-dimensional ring of fire. As the battered Endurance violently skims the black hole's event horizon, the ship's metallic hull glows bright red with friction, framed intimately against the overwhelmingly massive, brilliant inferno of the singularity's edge.

### 12) Tesseract bookshelf sequence
- File: `src/three/scenes/12TesseractScene.js`
- Build here: Cooper falls into a visually mind-bending, infinite grid composed of intersecting, extruded dimensions of Murph's childhood bedroom, represented through an endless, geometric repetition of wooden bookshelves and floating books. The tesseract is illuminated by a warm, ethereal, golden-brown light, where physical matter is stretched into continuous, glowing strings of time and gravity that Cooper can physically push and pluck like harp strings. Through the shifting, transparent slats of this massive, Escher-like construct, Cooper looks down into the intimately lit, dust-filled bedroom of his past, bridging a cold, incomprehensible higher-dimensional architecture with the nostalgic, tactile warmth of human memory.

### 13) Cooper Station reunion
- File: `src/three/scenes/13CooperStationScene.js`
- Build here: The visual landscape of Cooper Station reveals a pristine, futuristic O'Neill cylinder where the meticulously manicured green lawns, suburban farmhouses, and dirt roads curve impossibly upward, wrapping completely around the interior of a massive, sunlit tubular sky. Inside the station's brilliantly lit, sterile yet welcoming hospital room, soft, warm sunlight washes over a vast, multi-generational family gathered closely around a clean, white medical bed. The emotional visual climax rests on the stark, poignant contrast between Cooper, looking exactly as youthful and rugged as he did upon leaving Earth, and the incredibly frail, heavily wrinkled, elderly face of Murph, framed by soft white linens.

## Per-Scene Execution Checklist
For each scene file above:

1. Replace cube placeholder with blockout forms.
2. Add key recognition anchors first.
3. Add lighting/material pass.
4. Add ambient deterministic animation in `update`.
5. Confirm `dispose` fully cleans scene resources.
6. Validate transition in/out and camera inspect readability.

## Validation After Any Scene Task
Run both after each completed scene task:

- `npm run lint`
- `npm run build`

Then append implementation notes to:

- `.notes/notes.md`
