import * as THREE from 'three/webgpu'
import { disposeObject3D } from '../utils/dispose'

const STATION_RADIUS = 800
const STATION_BASE_LENGTH = 4000
const STATION_LENGTH = STATION_BASE_LENGTH * 2
const STATION_EXTENSION_OFFSET_Z = STATION_BASE_LENGTH / 2
const CYLINDER_SEGMENTS = 128
const LENGTH_SEGMENTS = 64
const HOUSE_NEIGHBORHOOD_CLUSTER_COUNT = 60
const REFERENCE_SKY_COLOR = 0xd4cebd
const STATION_SPIN_SPEED = 0.03
const CAMERA_INIT_POSITION = new THREE.Vector3(0, -600, -STATION_BASE_LENGTH * 0.35)
const CAMERA_INIT_LOOK_AT = new THREE.Vector3(0, -800, 0)

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

export default {
  id: 'cooper-station-reunion',
  title: 'Cooper Station Reunion',
  create() {
    let rootRef = null
    let sceneRef = null
    let cameraRef = null
    let rendererRef = null
    let sceneGroup = null

    let previousFog = null
    let previousBackground = null
    let previousToneMappingExposure = null
    let previousCameraProjection = null
    let stationSpinAngle = 0

        // -- Canvas texture helpers --
        function createCanvasTexture(w, h, drawFn) {
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const ctx = c.getContext('2d');
            drawFn(ctx, w, h);
            const tex = new THREE.CanvasTexture(c);
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            return tex;
        }

        // -- Ground texture (roughly gridded but natural) --
        function createGroundTexture() {
            return createCanvasTexture(2048, 2048, (ctx, w, h) => {
                const r = seededRandom(123);
                const GRID = 8; // rough grid divisions
                const cellW = w / GRID, cellH = h / GRID;

                // Base green with subtle noise
                ctx.fillStyle = '#4a7a2e';
                ctx.fillRect(0, 0, w, h);
                for (let y = 0; y < h; y += 8) {
                    for (let x = 0; x < w; x += 8) {
                        const g = 100 + Math.sin(x * 0.01) * 10 + (r() - 0.5) * 20;
                        const rb = 50 + (r() - 0.5) * 12;
                        ctx.fillStyle = `rgb(${Math.floor(rb)},${Math.floor(g)},${Math.floor(rb * 0.55)})`;
                        ctx.fillRect(x, y, 8, 8);
                    }
                }

                // Field patches in rough grid cells (randomized shapes within cells)
                const fieldColors = [
                    '#5a8a3e', '#3d6b22', '#7a9a4e', '#8b7d3a', '#6b8a2e',
                    '#4e7528', '#9a8844', '#c4a94e', '#6a9038', '#557722',
                    '#b8a050', '#7d8830', '#a09040', '#88a048'
                ];
                for (let gy = 0; gy < GRID; gy++) {
                    for (let gx = 0; gx < GRID; gx++) {
                        // 1-3 fields per cell
                        const numFields = 1 + Math.floor(r() * 3);
                        for (let f = 0; f < numFields; f++) {
                            const margin = 15 + r() * 10;
                            const fx = gx * cellW + margin + r() * (cellW * 0.15);
                            const fy = gy * cellH + margin + r() * (cellH * 0.15);
                            const fw = cellW * (0.3 + r() * 0.5) - margin;
                            const fh = cellH * (0.3 + r() * 0.5) - margin;

                            // Slightly irregular quad
                            ctx.fillStyle = fieldColors[Math.floor(r() * fieldColors.length)];
                            ctx.beginPath();
                            ctx.moveTo(fx + r() * 8, fy + r() * 8);
                            ctx.lineTo(fx + fw + r() * 8 - 4, fy + r() * 8 - 4);
                            ctx.lineTo(fx + fw + r() * 8, fy + fh + r() * 8);
                            ctx.lineTo(fx + r() * 8 - 4, fy + fh + r() * 8 - 4);
                            ctx.closePath();
                            ctx.fill();

                            // Crop rows
                            if (r() > 0.3) {
                                ctx.save();
                                ctx.clip();
                                ctx.strokeStyle = 'rgba(0,0,0,0.07)';
                                ctx.lineWidth = 1;
                                const vertical = r() > 0.5;
                                const step = 3 + r() * 3;
                                for (let j = 0; j < Math.max(fw, fh) * 1.5; j += step) {
                                    ctx.beginPath();
                                    if (vertical) {
                                        ctx.moveTo(fx + j + Math.sin(j * 0.1) * 2, fy - 10);
                                        ctx.lineTo(fx + j + Math.sin(j * 0.1 + 1) * 2, fy + fh + 10);
                                    } else {
                                        ctx.moveTo(fx - 10, fy + j + Math.sin(j * 0.1) * 2);
                                        ctx.lineTo(fx + fw + 10, fy + j + Math.sin(j * 0.1 + 1) * 2);
                                    }
                                    ctx.stroke();
                                }
                                ctx.restore();
                            }
                        }
                    }
                }

                // Roads along grid lines (slightly wavy, not perfectly straight)
                ctx.lineCap = 'round';
                // Vertical-ish roads
                for (let i = 1; i < GRID; i++) {
                    const baseX = i * cellW;
                    ctx.strokeStyle = '#555555';
                    ctx.lineWidth = 6 + r() * 3;
                    ctx.beginPath();
                    ctx.moveTo(baseX + (r() - 0.5) * 15, 0);
                    for (let y = 0; y <= h; y += h / 8) {
                        ctx.lineTo(baseX + (r() - 0.5) * 20, y);
                    }
                    ctx.stroke();
                    // Dashed center
                    ctx.strokeStyle = '#888877';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([5, 7]);
                    ctx.beginPath();
                    ctx.moveTo(baseX + (r() - 0.5) * 8, 0);
                    for (let y = 0; y <= h; y += h / 8) {
                        ctx.lineTo(baseX + (r() - 0.5) * 10, y);
                    }
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
                // Horizontal-ish roads
                for (let i = 1; i < GRID; i++) {
                    const baseY = i * cellH;
                    ctx.strokeStyle = '#555555';
                    ctx.lineWidth = 5 + r() * 3;
                    ctx.beginPath();
                    ctx.moveTo(0, baseY + (r() - 0.5) * 15);
                    for (let x = 0; x <= w; x += w / 8) {
                        ctx.lineTo(x, baseY + (r() - 0.5) * 20);
                    }
                    ctx.stroke();
                }

                // Secondary roads (fewer, within cells)
                for (let i = 0; i < 10; i++) {
                    const sx = r() * w, sy = r() * h;
                    const ex = sx + (r() - 0.5) * cellW * 2;
                    const ey = sy + (r() - 0.5) * cellH * 2;
                    ctx.strokeStyle = '#666';
                    ctx.lineWidth = 3 + r() * 2;
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    ctx.quadraticCurveTo(sx + (r() - 0.5) * 80, sy + (r() - 0.5) * 80, ex, ey);
                    ctx.stroke();
                }

                // Houses in neighborhood clusters (near intersections)
                const houseColors = ['#c8b898', '#b8a888', '#d4c4a4', '#a89878', '#e0d0b0', '#988868', '#fff8f0', '#e8e0d0', '#8b7355', '#ccbbaa'];
                for (let gy = 0; gy < GRID; gy++) {
                    for (let gx = 0; gx < GRID; gx++) {
                        if (r() > 0.55) continue; // not every cell has houses
                        const cx = gx * cellW + cellW * (0.3 + r() * 0.4);
                        const cy = gy * cellH + cellH * (0.3 + r() * 0.4);
                        const numH = 3 + Math.floor(r() * 12);
                        for (let hi = 0; hi < numH; hi++) {
                            const bx = cx + (r() - 0.5) * cellW * 0.5;
                            const by = cy + (r() - 0.5) * cellH * 0.5;
                            const bw = 6 + r() * 10;
                            const bh = 6 + r() * 10;
                            ctx.save();
                            ctx.translate(bx, by);
                            ctx.rotate((r() - 0.5) * 0.25);
                            ctx.fillStyle = houseColors[Math.floor(r() * houseColors.length)];
                            ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
                            ctx.fillStyle = 'rgba(0,0,0,0.15)';
                            ctx.fillRect(-bw / 2, -bh / 2, bw, 3);
                            ctx.restore();
                        }
                    }
                }

                // Parks (near some intersections)
                for (let i = 0; i < 12; i++) {
                    const px = (Math.floor(r() * GRID) + 0.5) * cellW + (r() - 0.5) * 30;
                    const py = (Math.floor(r() * GRID) + 0.5) * cellH + (r() - 0.5) * 30;
                    const pr = 15 + r() * 30;
                    ctx.fillStyle = `rgba(${25 + r() * 15},${90 + r() * 50},${25 + r() * 15},0.75)`;
                    ctx.beginPath();
                    const nPts = 5 + Math.floor(r() * 4);
                    for (let p = 0; p < nPts; p++) {
                        const a = (p / nPts) * Math.PI * 2;
                        const rad = pr * (0.7 + r() * 0.5);
                        if (p === 0) ctx.moveTo(px + Math.cos(a) * rad, py + Math.sin(a) * rad);
                        else ctx.lineTo(px + Math.cos(a) * rad, py + Math.sin(a) * rad);
                    }
                    ctx.closePath();
                    ctx.fill();
                }

                // Trees scattered (denser near parks and roads)
                for (let i = 0; i < 1000; i++) {
                    const tx = r() * w, ty = r() * h;
                    const ts = 1.5 + r() * 4;
                    ctx.fillStyle = `rgb(${15 + r() * 35},${45 + r() * 65},${10 + r() * 25})`;
                    ctx.beginPath(); ctx.arc(tx, ty, ts, 0, Math.PI * 2); ctx.fill();
                }

                // Water features
                for (let i = 0; i < 6; i++) {
                    const lx = r() * w, ly = r() * h;
                    ctx.fillStyle = `rgba(${30 + r() * 15},${65 + r() * 25},${115 + r() * 35},0.6)`;
                    ctx.beginPath();
                    ctx.ellipse(lx, ly, 12 + r() * 25, 8 + r() * 18, r() * Math.PI, 0, Math.PI * 2);
                    ctx.fill();
                }

                // Dirt paths
                for (let i = 0; i < 10; i++) {
                    ctx.strokeStyle = `rgba(${135 + r() * 25},${115 + r() * 20},${75 + r() * 20},0.4)`;
                    ctx.lineWidth = 2 + r() * 1.5;
                    ctx.beginPath();
                    let px2 = r() * w, py2 = r() * h;
                    ctx.moveTo(px2, py2);
                    for (let s = 0; s < 3 + r() * 3; s++) {
                        px2 += (r() - 0.5) * 120;
                        py2 += (r() - 0.5) * 120;
                        ctx.lineTo(px2, py2);
                    }
                    ctx.stroke();
                }
            });
        }

        // -- Normal map for ground --
        function createGroundNormalMap() {
            return createCanvasTexture(1024, 1024, (ctx, w, h) => {
                ctx.fillStyle = '#8080ff';
                ctx.fillRect(0, 0, w, h);
                const r = seededRandom(789);
                for (let i = 0; i < 2000; i++) {
                    const x = r() * w, y = r() * h, s = 1 + r() * 4;
                    const v = 100 + r() * 60;
                    ctx.fillStyle = `rgb(${v},${v},255)`;
                    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
                }
            });
        }

        function createRadialGlowTexture(size, color, alphaStops) {
            const tex = createCanvasTexture(size, size, (ctx, w, h) => {
                const cx = w * 0.5;
                const cy = h * 0.5;
                const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.5);
                for (const [stop, alpha] of alphaStops) {
                    grad.addColorStop(stop, `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`);
                }
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, w, h);
            });
            tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
            tex.colorSpace = THREE.SRGBColorSpace;
            return tex;
        }


        // -- Build cylinder ground (inside of station) --
        function buildGround() {
            const geo = new THREE.CylinderGeometry(
                STATION_RADIUS, STATION_RADIUS, STATION_LENGTH,
                CYLINDER_SEGMENTS, LENGTH_SEGMENTS, true
            );

            const groundTex = createGroundTexture();
            groundTex.repeat.set(12, 6);
            groundTex.colorSpace = THREE.SRGBColorSpace;

            const normalMap = createGroundNormalMap();
            normalMap.repeat.set(12, 6);

            const mat = new THREE.MeshStandardMaterial({
                map: groundTex,
                normalMap: normalMap,
                normalScale: new THREE.Vector2(0.3, 0.3),
                roughness: 0.85,
                metalness: 0.0,
                side: THREE.BackSide,
            });

            const mesh = new THREE.Mesh(geo, mat);
            mesh.rotation.x = Math.PI / 2;
            mesh.receiveShadow = true;
            sceneGroup.add(mesh);
            return mesh;
        }


        // -- End caps - bright sun-like glowing discs --
        function buildEndCaps() {
            const group = new THREE.Group();
            const glowColor = { r: 255, g: 247, b: 232 };
            const coreMistMap = createRadialGlowTexture(1024, glowColor, [
                [0, 1],
                [0.2, 0.92],
                [0.5, 0.45],
                [0.85, 0.08],
                [1, 0],
            ]);
            const wideMistMap = createRadialGlowTexture(1024, glowColor, [
                [0, 0.72],
                [0.28, 0.42],
                [0.65, 0.14],
                [1, 0],
            ]);

            for (let side = -1; side <= 1; side += 2) {
                const endZ = side * STATION_LENGTH / 2;

                const discGeo = new THREE.CircleGeometry(STATION_RADIUS * 0.75, 96);
                const discMat = new THREE.MeshBasicMaterial({
                    color: 0xffffff,
                    side: THREE.DoubleSide,
                    toneMapped: false,
                });
                const disc = new THREE.Mesh(discGeo, discMat);
                disc.position.z = endZ;
                group.add(disc);

                const coreMistGeo = new THREE.CircleGeometry(STATION_RADIUS * 1.6, 96);
                const coreMistMat = new THREE.MeshBasicMaterial({
                    map: coreMistMap,
                    color: 0xfff6e8,
                    transparent: true,
                    opacity: 0.95,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                    depthTest: false,
                    blending: THREE.AdditiveBlending,
                    toneMapped: false,
                });
                const coreMist = new THREE.Mesh(coreMistGeo, coreMistMat);
                coreMist.position.z = endZ - side * 20;
                group.add(coreMist);

                const midMistGeo = new THREE.CircleGeometry(STATION_RADIUS * 2.3, 96);
                const midMistMat = new THREE.MeshBasicMaterial({
                    map: wideMistMap,
                    color: 0xf4e5c9,
                    transparent: true,
                    opacity: 0.62,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                    depthTest: false,
                    blending: THREE.AdditiveBlending,
                    toneMapped: false,
                });
                const midMist = new THREE.Mesh(midMistGeo, midMistMat);
                midMist.position.z = endZ - side * 95;
                group.add(midMist);

                const outerMistGeo = new THREE.CircleGeometry(STATION_RADIUS * 3.1, 96);
                const outerMistMat = new THREE.MeshBasicMaterial({
                    map: wideMistMap,
                    color: 0xeedbb8,
                    transparent: true,
                    opacity: 0.35,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                    depthTest: false,
                    blending: THREE.AdditiveBlending,
                    toneMapped: false,
                });
                const outerMist = new THREE.Mesh(outerMistGeo, outerMistMat);
                outerMist.position.z = endZ - side * 220;
                group.add(outerMist);
            }

            sceneGroup.add(group);
            return group;
        }


        // -- 3D Houses on inner cylinder surface --
        function placeHousesOnSurface() {
            const group = new THREE.Group();
            const r = seededRandom(555);

            const houseMaterials = [
                new THREE.MeshStandardMaterial({ color: 0xc8b898, roughness: 0.8 }),
                new THREE.MeshStandardMaterial({ color: 0xb8a888, roughness: 0.8 }),
                new THREE.MeshStandardMaterial({ color: 0xd4c4a4, roughness: 0.8 }),
                new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.8 }),
                new THREE.MeshStandardMaterial({ color: 0xa09080, roughness: 0.8 }),
                new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
                new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.9 }),
            ];
            const roofMaterials = [
                new THREE.MeshStandardMaterial({ color: 0x664433, roughness: 0.9 }),
                new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.7, metalness: 0.2 }),
                new THREE.MeshStandardMaterial({ color: 0x884422, roughness: 0.85 }),
                new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6, metalness: 0.3 }),
            ];

            // Neighborhood clusters (more, bigger spread)
            const neighborhoods = [];
            for (let i = 0; i < HOUSE_NEIGHBORHOOD_CLUSTER_COUNT; i++) {
                neighborhoods.push({
                    angle: r() * Math.PI * 2,
                    z: (r() - 0.5) * STATION_LENGTH * 0.85,
                    spread: 50 + r() * 100,
                    count: 10 + Math.floor(r() * 25)
                });
            }

            for (const nb of neighborhoods) {
                for (let i = 0; i < nb.count; i++) {
                    const angle = nb.angle + (r() - 0.5) * nb.spread / STATION_RADIUS;
                    const z = nb.z + (r() - 0.5) * nb.spread * 2;

                    // Position on inside of cylinder
                    const px = Math.cos(angle) * (STATION_RADIUS - 5);
                    const py = Math.sin(angle) * (STATION_RADIUS - 5);

                    // House body (realistic scale: ~10-20m wide, 6-12m tall)
                    const hw = 12 + r() * 14;
                    const hh = 7 + r() * 8;
                    const hd = 12 + r() * 14;
                    const bodyGeo = new THREE.BoxGeometry(hw, hh, hd);
                    const body = new THREE.Mesh(bodyGeo, houseMaterials[Math.floor(r() * houseMaterials.length)]);
                    body.castShadow = true;

                    // Roof
                    const roofGeo = new THREE.ConeGeometry(Math.max(hw, hd) * 0.7, 4 + r() * 4, 4);
                    const roof = new THREE.Mesh(roofGeo, roofMaterials[Math.floor(r() * roofMaterials.length)]);
                    roof.position.y = hh / 2 + 2;
                    roof.rotation.y = Math.PI / 4;

                    const house = new THREE.Group();
                    house.add(body);
                    house.add(roof);

                    house.position.set(px, py, z);
                    // Orient to face center
                    house.lookAt(0, 0, z);
                    house.rotateX(Math.PI / 2);

                    group.add(house);
                }
            }
            sceneGroup.add(group);
            return group;
        }


        // -- Trees on station surface --
        function placeTreesOnSurface() {
            const group = new THREE.Group();
            const r = seededRandom(777);

            // Simple tree using merged geometry for performance
            const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, 4, 5);
            const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.95 });

            const foliageMats = [
                new THREE.MeshStandardMaterial({ color: 0x2d6b1e, roughness: 0.9 }),
                new THREE.MeshStandardMaterial({ color: 0x3a7a28, roughness: 0.9 }),
                new THREE.MeshStandardMaterial({ color: 0x1e5a14, roughness: 0.9 }),
                new THREE.MeshStandardMaterial({ color: 0x4a8a3e, roughness: 0.9 }),
            ];

            for (let i = 0; i < 600; i++) {
                const angle = r() * Math.PI * 2;
                const z = (r() - 0.5) * STATION_LENGTH * 0.85;
                const px = Math.cos(angle) * (STATION_RADIUS - 3);
                const py = Math.sin(angle) * (STATION_RADIUS - 3);

                const tree = new THREE.Group();
                const trunk = new THREE.Mesh(trunkGeo, trunkMat);
                tree.add(trunk);

                const treeType = r();
                if (treeType < 0.5) {
                    // Deciduous - sphere canopy
                    const s = 2 + r() * 3;
                    const canopyGeo = new THREE.SphereGeometry(s, 6, 5);
                    const canopy = new THREE.Mesh(canopyGeo, foliageMats[Math.floor(r() * foliageMats.length)]);
                    canopy.position.y = 3 + s * 0.6;
                    tree.add(canopy);
                } else if (treeType < 0.8) {
                    // Conifer - cone
                    const s = 2 + r() * 2;
                    const coneGeo = new THREE.ConeGeometry(s, s * 2.5, 6);
                    const cone = new THREE.Mesh(coneGeo, foliageMats[Math.floor(r() * foliageMats.length)]);
                    cone.position.y = 3 + s;
                    tree.add(cone);
                } else {
                    // Multi-sphere
                    for (let j = 0; j < 3; j++) {
                        const s = 1.5 + r() * 1.5;
                        const sg = new THREE.SphereGeometry(s, 5, 4);
                        const sm = new THREE.Mesh(sg, foliageMats[Math.floor(r() * foliageMats.length)]);
                        sm.position.set((r() - 0.5) * 2, 3 + j * 1.8, (r() - 0.5) * 2);
                        tree.add(sm);
                    }
                }

                tree.position.set(px, py, z);
                tree.lookAt(0, 0, z);
                tree.rotateX(Math.PI / 2);
                const sc = 0.7 + r() * 0.6;
                tree.scale.set(sc, sc, sc);

                group.add(tree);
            }
            sceneGroup.add(group);
            return group;
        }


        // -- Roads (texture only, no 3D geometry) --
        function buildRoads() {
            // Roads are now rendered only in the ground texture (Bezier curves)
            // No 3D geometry that could poke through the cylinder
        }


        // -- Fences / barriers between zones --
        function buildFences() {
            const group = new THREE.Group();
            const fenceMat = new THREE.MeshStandardMaterial({
                color: 0x8b6b4a, roughness: 0.9
            });

            const r = seededRandom(333);
            for (let i = 0; i < 40; i++) {
                const angle = r() * Math.PI * 2;
                const z = (r() - 0.5) * STATION_LENGTH * 0.8;
                const fenceLen = 20 + r() * 60;
                const fenceGeo = new THREE.BoxGeometry(fenceLen, 2, 0.3);
                const fence = new THREE.Mesh(fenceGeo, fenceMat);

                const px = Math.cos(angle) * (STATION_RADIUS - 2);
                const py = Math.sin(angle) * (STATION_RADIUS - 2);
                fence.position.set(px, py, z);
                fence.lookAt(0, 0, z);
                fence.rotateX(Math.PI / 2);
                group.add(fence);
            }
            sceneGroup.add(group);
        }

        // -- Playground / park features --
        function buildPlaygrounds() {
            const group = new THREE.Group();
            const r = seededRandom(999);
            const metalMat = new THREE.MeshStandardMaterial({ color: 0xcc4444, metalness: 0.5, roughness: 0.4 });
            const blueMat = new THREE.MeshStandardMaterial({ color: 0x4488cc, metalness: 0.5, roughness: 0.4 });
            const greenMat = new THREE.MeshStandardMaterial({ color: 0x44aa44, roughness: 0.7 });

            for (let i = 0; i < 10; i++) {
                const angle = r() * Math.PI * 2;
                const z = (r() - 0.5) * STATION_LENGTH * 0.7;

                const park = new THREE.Group();

                // Swing set
                const frameGeo = new THREE.BoxGeometry(0.3, 5, 8);
                const frame1 = new THREE.Mesh(frameGeo, metalMat);
                frame1.position.set(-3, 2.5, 0);
                const frame2 = new THREE.Mesh(frameGeo, metalMat);
                frame2.position.set(3, 2.5, 0);
                park.add(frame1, frame2);

                const topBar = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.3, 0.3), metalMat);
                topBar.position.y = 5;
                park.add(topBar);

                // Slide
                const slideGeo = new THREE.BoxGeometry(2, 0.1, 6);
                const slide = new THREE.Mesh(slideGeo, blueMat);
                slide.position.set(8, 2, 0);
                slide.rotation.x = -0.3;
                park.add(slide);

                // Green area (grass circle)
                const grassGeo = new THREE.CircleGeometry(12, 16);
                const grass = new THREE.Mesh(grassGeo, greenMat);
                grass.rotation.x = -Math.PI / 2;
                grass.position.y = -0.1;
                park.add(grass);

                const px = Math.cos(angle) * (STATION_RADIUS - 3);
                const py = Math.sin(angle) * (STATION_RADIUS - 3);
                park.position.set(px, py, z);
                park.lookAt(0, 0, z);
                park.rotateX(Math.PI / 2);
                park.scale.setScalar(0.8);

                group.add(park);
            }
            sceneGroup.add(group);
        }


        // -- Baseball diamonds and sports fields --
        function buildSportsFields() {
            const group = new THREE.Group();
            const r = seededRandom(1234);
            const dirtMat = new THREE.MeshStandardMaterial({ color: 0xb8956a, roughness: 0.95 });
            const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });

            for (let i = 0; i < 5; i++) {
                const angle = r() * Math.PI * 2;
                const z = (r() - 0.5) * STATION_LENGTH * 0.7;
                const field = new THREE.Group();

                // Diamond shape
                const diamondGeo = new THREE.CircleGeometry(20, 4);
                const diamond = new THREE.Mesh(diamondGeo, dirtMat);
                diamond.rotation.x = -Math.PI / 2;
                diamond.rotation.z = Math.PI / 4;
                field.add(diamond);

                // Base lines
                for (let j = 0; j < 4; j++) {
                    const a = (j / 4) * Math.PI * 2 + Math.PI / 4;
                    const lineGeo = new THREE.BoxGeometry(0.3, 0.05, 20);
                    const line = new THREE.Mesh(lineGeo, lineMat);
                    line.position.set(Math.cos(a) * 10, 0.05, Math.sin(a) * 10);
                    line.rotation.y = a;
                    field.add(line);
                }

                const px = Math.cos(angle) * (STATION_RADIUS - 2);
                const py = Math.sin(angle) * (STATION_RADIUS - 2);
                field.position.set(px, py, z);
                field.lookAt(0, 0, z);
                field.rotateX(Math.PI / 2);
                group.add(field);
            }
            sceneGroup.add(group);
        }

        // -- Atmospheric haze only (no central tube) --
        function buildAtmosphere() {
            const hazeGeo = new THREE.BufferGeometry();
            const hazeCount = 2000;
            const positions = new Float32Array(hazeCount * 3);
            const rr = seededRandom(8888);
            for (let i = 0; i < hazeCount; i++) {
                const a = rr() * Math.PI * 2;
                const rad = 100 + rr() * (STATION_RADIUS - 150);
                positions[i * 3] = Math.cos(a) * rad;
                positions[i * 3 + 1] = Math.sin(a) * rad;
                positions[i * 3 + 2] = (rr() - 0.5) * STATION_LENGTH;
            }
            hazeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            const hazeMat = new THREE.PointsMaterial({
                color: 0xf1e6d3,
                size: 2,
                transparent: true,
                opacity: 0.065,
                depthWrite: false
            });
            const haze = new THREE.Points(hazeGeo, hazeMat);
            sceneGroup.add(haze);
        }


        // -- Lighting setup (realistic sunlight from end of cylinder) --
        function setupLighting() {
            const sunLight = new THREE.DirectionalLight(0xffeedd, 2.5);
            sunLight.position.set(0, STATION_RADIUS * 0.6, -STATION_LENGTH * 0.5);
            sunLight.target.position.set(0, -STATION_RADIUS, -100);
            sceneGroup.add(sunLight);
            sceneGroup.add(sunLight.target);

            const fillLight = new THREE.DirectionalLight(0xfff2dd, 1.8);
            fillLight.position.set(0, STATION_RADIUS * 0.6, STATION_LENGTH * 0.5);
            fillLight.target.position.set(0, -STATION_RADIUS, 100);
            sceneGroup.add(fillLight);
            sceneGroup.add(fillLight.target);

            const ambient = new THREE.AmbientLight(0xfff5e6, 0.45);
            sceneGroup.add(ambient);

            const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.35);
            sceneGroup.add(hemi);
        }

        // -- Sky / background --
        function buildSkybox() {
            sceneRef.background = new THREE.Color(REFERENCE_SKY_COLOR);
        }

        // -- Lampposts along roads --
        function buildLampposts() {
            const group = new THREE.Group();
            const poleMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.7, roughness: 0.3 });
            const lightMat = new THREE.MeshBasicMaterial({ color: 0xffeecc });
            const r = seededRandom(4444);

            for (let i = 0; i < 120; i++) {
                const angle = r() * Math.PI * 2;
                const z = (r() - 0.5) * STATION_LENGTH * 0.85;

                const post = new THREE.Group();
                const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 6, 6), poleMat);
                pole.position.y = 3;
                post.add(pole);

                const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 4), lightMat);
                lamp.position.y = 6.2;
                post.add(lamp);

                const px = Math.cos(angle) * (STATION_RADIUS - 2);
                const py = Math.sin(angle) * (STATION_RADIUS - 2);
                post.position.set(px, py, z);
                post.lookAt(0, 0, z);
                post.rotateX(Math.PI / 2);
                group.add(post);
            }
            sceneGroup.add(group);
        }

        // -- Water tower / community buildings --
        function buildCommunityStructures() {
            const group = new THREE.Group();
            const r = seededRandom(5555);
            const concreteMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.8 });
            const waterTowerMat = new THREE.MeshStandardMaterial({ color: 0x7799bb, metalness: 0.4, roughness: 0.5 });

            // Water towers
            for (let i = 0; i < 4; i++) {
                const angle = r() * Math.PI * 2;
                const z = (r() - 0.5) * STATION_LENGTH * 0.6;

                const tower = new THREE.Group();
                // Legs
                for (let j = 0; j < 4; j++) {
                    const la = (j / 4) * Math.PI * 2;
                    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 15, 6), concreteMat);
                    leg.position.set(Math.cos(la) * 3, 7.5, Math.sin(la) * 3);
                    tower.add(leg);
                }
                // Tank
                const tank = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 6), waterTowerMat);
                tank.position.y = 17;
                tank.scale.y = 0.7;
                tower.add(tank);

                const px = Math.cos(angle) * (STATION_RADIUS - 5);
                const py = Math.sin(angle) * (STATION_RADIUS - 5);
                tower.position.set(px, py, z);
                tower.lookAt(0, 0, z);
                tower.rotateX(Math.PI / 2);
                tower.scale.setScalar(1.2);
                group.add(tower);
            }

            // Schools / larger buildings
            for (let i = 0; i < 6; i++) {
                const angle = r() * Math.PI * 2;
                const z = (r() - 0.5) * STATION_LENGTH * 0.7;

                const bldg = new THREE.Group();
                const body = new THREE.Mesh(
                    new THREE.BoxGeometry(25 + r() * 15, 8 + r() * 6, 20 + r() * 10),
                    new THREE.MeshStandardMaterial({ color: 0xccbbaa, roughness: 0.8 })
                );
                body.position.y = 5;
                bldg.add(body);

                // Flat roof
                const roof = new THREE.Mesh(
                    new THREE.BoxGeometry(28 + r() * 15, 1, 23 + r() * 10),
                    new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.7 })
                );
                roof.position.y = 10;
                bldg.add(roof);

                const px = Math.cos(angle) * (STATION_RADIUS - 6);
                const py = Math.sin(angle) * (STATION_RADIUS - 6);
                bldg.position.set(px, py, z);
                bldg.lookAt(0, 0, z);
                bldg.rotateX(Math.PI / 2);
                group.add(bldg);
            }

            sceneGroup.add(group);
        }


        // -- Helper: place object on cylinder inner surface --
        function placeOnSurface(obj, angle, z, inset = 3) {
            const px = Math.cos(angle) * (STATION_RADIUS - inset);
            const py = Math.sin(angle) * (STATION_RADIUS - inset);
            obj.position.set(px, py, z);
            obj.lookAt(0, 0, z);
            obj.rotateX(Math.PI / 2);
        }

        // -- Churches / chapels --
        function buildChurches() {
            const group = new THREE.Group();
            const r = seededRandom(7001);
            const wallMat = new THREE.MeshStandardMaterial({ color: 0xf0e8d8, roughness: 0.8 });
            const steepleRoof = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.6, metalness: 0.2 });

            for (let i = 0; i < 4; i++) {
                const church = new THREE.Group();
                // Nave
                const nave = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 18), wallMat);
                nave.position.y = 4;
                church.add(nave);
                // Pitched roof
                const roofGeo = new THREE.ConeGeometry(9, 4, 4);
                const roof = new THREE.Mesh(roofGeo, steepleRoof);
                roof.position.y = 10;
                roof.rotation.y = Math.PI / 4;
                church.add(roof);
                // Steeple
                const steeple = new THREE.Mesh(new THREE.BoxGeometry(3, 12, 3), wallMat);
                steeple.position.set(0, 10, -7);
                church.add(steeple);
                const spire = new THREE.Mesh(new THREE.ConeGeometry(2.5, 8, 8), steepleRoof);
                spire.position.set(0, 20, -7);
                church.add(spire);

                placeOnSurface(church, r() * Math.PI * 2, (r() - 0.5) * STATION_LENGTH * 0.7, 5);
                group.add(church);
            }
            sceneGroup.add(group);
        }

        // -- Gas stations / shops --
        function buildGasStations() {
            const group = new THREE.Group();
            const r = seededRandom(7101);
            const canopyMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.3, metalness: 0.4 });
            const pumpMat = new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.6 });
            const concreteMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.9 });

            for (let i = 0; i < 6; i++) {
                const station = new THREE.Group();
                // Concrete pad
                const pad = new THREE.Mesh(new THREE.BoxGeometry(20, 0.3, 15), concreteMat);
                station.add(pad);
                // Canopy
                const canopy = new THREE.Mesh(new THREE.BoxGeometry(18, 0.4, 12), canopyMat);
                canopy.position.y = 5;
                station.add(canopy);
                // Canopy pillars
                for (let cx = -7; cx <= 7; cx += 14) {
                    for (let cz = -4; cz <= 4; cz += 8) {
                        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 5, 6), canopyMat);
                        pillar.position.set(cx, 2.5, cz);
                        station.add(pillar);
                    }
                }
                // Fuel pumps
                for (let p = -4; p <= 4; p += 4) {
                    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.5, 0.8), pumpMat);
                    pump.position.set(p, 1.25, 0);
                    station.add(pump);
                }
                // Small shop building
                const shop = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 6), new THREE.MeshStandardMaterial({ color: 0xddd8c8, roughness: 0.8 }));
                shop.position.set(0, 2, -9);
                station.add(shop);

                placeOnSurface(station, r() * Math.PI * 2, (r() - 0.5) * STATION_LENGTH * 0.75, 4);
                group.add(station);
            }
            sceneGroup.add(group);
        }

        // -- Parking lots --
        function buildParkingLots() {
            const group = new THREE.Group();
            const r = seededRandom(7201);
            const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.95 });
            const carColors = [0xcc2222, 0x2255cc, 0xeeeeee, 0x222222, 0x88aa44, 0xddaa22, 0x666666, 0xaa4422];

            for (let i = 0; i < 10; i++) {
                const lot = new THREE.Group();
                const lotW = 20 + r() * 20;
                const lotD = 15 + r() * 15;
                const surface = new THREE.Mesh(new THREE.BoxGeometry(lotW, 0.2, lotD), asphaltMat);
                lot.add(surface);

                // Cars
                const numCars = 4 + Math.floor(r() * 10);
                for (let c = 0; c < numCars; c++) {
                    const carMat = new THREE.MeshStandardMaterial({
                        color: carColors[Math.floor(r() * carColors.length)],
                        roughness: 0.4, metalness: 0.3
                    });
                    const car = new THREE.Group();
                    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 4.5), carMat);
                    body.position.y = 0.7;
                    car.add(body);
                    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 2.2),
                        new THREE.MeshStandardMaterial({ color: 0x336699, roughness: 0.1, metalness: 0.3 }));
                    cabin.position.y = 1.6;
                    car.add(cabin);
                    car.position.set((r() - 0.5) * (lotW - 4), 0.1, (r() - 0.5) * (lotD - 5));
                    car.rotation.y = r() > 0.5 ? 0 : Math.PI;
                    lot.add(car);
                }

                placeOnSurface(lot, r() * Math.PI * 2, (r() - 0.5) * STATION_LENGTH * 0.75, 3);
                group.add(lot);
            }
            sceneGroup.add(group);
        }

        // -- Swimming pools --
        function buildSwimmingPools() {
            const group = new THREE.Group();
            const r = seededRandom(7301);
            const waterMat = new THREE.MeshStandardMaterial({ color: 0x44aadd, roughness: 0.1, metalness: 0.1 });
            const deckMat = new THREE.MeshStandardMaterial({ color: 0xccbbaa, roughness: 0.85 });

            for (let i = 0; i < 5; i++) {
                const pool = new THREE.Group();
                // Deck
                const deck = new THREE.Mesh(new THREE.BoxGeometry(18, 0.3, 12), deckMat);
                pool.add(deck);
                // Water
                const water = new THREE.Mesh(new THREE.BoxGeometry(14, 0.1, 8), waterMat);
                water.position.y = 0.05;
                pool.add(water);
                // Pool border
                const borderMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
                for (let bx = -1; bx <= 1; bx += 2) {
                    const brd = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 8), borderMat);
                    brd.position.set(bx * 7.25, 0.3, 0);
                    pool.add(brd);
                }
                for (let bz = -1; bz <= 1; bz += 2) {
                    const brd = new THREE.Mesh(new THREE.BoxGeometry(15, 0.5, 0.5), borderMat);
                    brd.position.set(0, 0.3, bz * 4.25);
                    pool.add(brd);
                }

                placeOnSurface(pool, r() * Math.PI * 2, (r() - 0.5) * STATION_LENGTH * 0.6, 3);
                group.add(pool);
            }
            sceneGroup.add(group);
        }

        // -- Vehicles on roads --
        function buildVehiclesOnRoads() {
            const group = new THREE.Group();
            const r = seededRandom(7401);
            const carColors = [0xcc2222, 0x2255cc, 0xeeeeee, 0x222222, 0x88aa44, 0xddaa22, 0xffffff, 0x444444];

            for (let i = 0; i < 80; i++) {
                const carMat = new THREE.MeshStandardMaterial({
                    color: carColors[Math.floor(r() * carColors.length)],
                    roughness: 0.4, metalness: 0.3
                });
                const car = new THREE.Group();
                const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1.1, 4), carMat);
                body.position.y = 0.6;
                car.add(body);
                const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 2),
                    new THREE.MeshStandardMaterial({ color: 0x336699, roughness: 0.1, metalness: 0.3 }));
                cabin.position.y = 1.5;
                car.add(cabin);

                const angle = r() * Math.PI * 2;
                const z = (r() - 0.5) * STATION_LENGTH * 0.85;
                placeOnSurface(car, angle, z, 1.5);
                group.add(car);
            }
            sceneGroup.add(group);
        }

        // -- Greenhouses --
        function buildGreenhouses() {
            const group = new THREE.Group();
            const r = seededRandom(7501);
            const glassMat = new THREE.MeshStandardMaterial({
                color: 0xaaddaa, roughness: 0.05, metalness: 0.1,
                transparent: true, opacity: 0.5
            });

            for (let i = 0; i < 8; i++) {
                const gh = new THREE.Group();
                const w = 8 + r() * 6, d = 15 + r() * 15;
                // Glass body (Quonset hut shape)
                const bodyGeo = new THREE.CylinderGeometry(w / 2, w / 2, d, 12, 1, true, 0, Math.PI);
                const body = new THREE.Mesh(bodyGeo, glassMat);
                body.rotation.z = Math.PI / 2;
                body.rotation.y = Math.PI / 2;
                body.position.y = 0;
                gh.add(body);
                // End walls
                for (let s = -1; s <= 1; s += 2) {
                    const endGeo = new THREE.CircleGeometry(w / 2, 12, 0, Math.PI);
                    const end = new THREE.Mesh(endGeo, glassMat);
                    end.position.set(0, 0, s * d / 2);
                    end.rotation.x = s > 0 ? 0 : Math.PI;
                    gh.add(end);
                }

                placeOnSurface(gh, r() * Math.PI * 2, (r() - 0.5) * STATION_LENGTH * 0.7, 2);
                group.add(gh);
            }
            sceneGroup.add(group);
        }

        // -- Grain silos --
        function buildSilos() {
            const group = new THREE.Group();
            const r = seededRandom(7601);
            const siloMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, roughness: 0.5, metalness: 0.4 });
            const roofMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.5 });

            for (let i = 0; i < 12; i++) {
                const silo = new THREE.Group();
                const rad = 2 + r() * 2;
                const ht = 8 + r() * 10;
                const body = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, ht, 12), siloMat);
                body.position.y = ht / 2;
                silo.add(body);
                const cap = new THREE.Mesh(new THREE.ConeGeometry(rad + 0.3, 3, 12), roofMat);
                cap.position.y = ht + 1.5;
                silo.add(cap);

                // Cluster 2-4 silos together
                const cluster = new THREE.Group();
                cluster.add(silo);
                const extras = Math.floor(r() * 3);
                for (let j = 0; j < extras; j++) {
                    const s2 = silo.clone();
                    s2.position.set((r() - 0.5) * 8, 0, (r() - 0.5) * 8);
                    const sc = 0.6 + r() * 0.5;
                    s2.scale.setScalar(sc);
                    cluster.add(s2);
                }

                placeOnSurface(cluster, r() * Math.PI * 2, (r() - 0.5) * STATION_LENGTH * 0.8, 4);
                group.add(cluster);
            }
            sceneGroup.add(group);
        }

        // -- Bridges over roads --
        function buildBridges() {
            const group = new THREE.Group();
            const r = seededRandom(7701);
            const concreteMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.8 });
            const railMat = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.5, roughness: 0.4 });

            for (let i = 0; i < 8; i++) {
                const bridge = new THREE.Group();
                const span = 15 + r() * 10;
                // Deck
                const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 0.5, 6), concreteMat);
                deck.position.y = 6;
                bridge.add(deck);
                // Pillars
                for (let px = -span / 2 + 2; px <= span / 2 - 2; px += span - 4) {
                    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6, 1.5), concreteMat);
                    pillar.position.set(px, 3, 0);
                    bridge.add(pillar);
                }
                // Railings
                for (let rz = -1; rz <= 1; rz += 2) {
                    const rail = new THREE.Mesh(new THREE.BoxGeometry(span, 1.2, 0.2), railMat);
                    rail.position.set(0, 7, rz * 2.8);
                    bridge.add(rail);
                }

                placeOnSurface(bridge, r() * Math.PI * 2, (r() - 0.5) * STATION_LENGTH * 0.7, 4);
                group.add(bridge);
            }
            sceneGroup.add(group);
        }

        // -- Picnic areas / park benches --
        function buildPicnicAreas() {
            const group = new THREE.Group();
            const r = seededRandom(7801);
            const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b6b4a, roughness: 0.9 });
            const grassMat = new THREE.MeshStandardMaterial({ color: 0x3a8a2e, roughness: 0.95 });

            for (let i = 0; i < 15; i++) {
                const area = new THREE.Group();
                // Grass patch
                const patch = new THREE.Mesh(new THREE.CircleGeometry(8, 12), grassMat);
                patch.rotation.x = -Math.PI / 2;
                area.add(patch);
                // Picnic tables
                for (let t = 0; t < 2 + Math.floor(r() * 3); t++) {
                    const table = new THREE.Group();
                    const top = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.15, 1.2), woodMat);
                    top.position.y = 1;
                    table.add(top);
                    // Benches
                    for (let bs = -1; bs <= 1; bs += 2) {
                        const bench = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.1, 0.5), woodMat);
                        bench.position.set(0, 0.6, bs * 0.9);
                        table.add(bench);
                    }
                    // Legs
                    for (let lx = -1; lx <= 1; lx += 2) {
                        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), woodMat);
                        leg.position.set(lx * 1, 0.5, 0);
                        table.add(leg);
                    }
                    table.position.set((r() - 0.5) * 10, 0, (r() - 0.5) * 10);
                    table.rotation.y = r() * Math.PI;
                    area.add(table);
                }

                placeOnSurface(area, r() * Math.PI * 2, (r() - 0.5) * STATION_LENGTH * 0.7, 3);
                group.add(area);
            }
            sceneGroup.add(group);
        }

        // -- Power line poles --
        function buildPowerLines() {
            const group = new THREE.Group();
            const r = seededRandom(7901);
            const poleMat = new THREE.MeshStandardMaterial({ color: 0x6b5b4a, roughness: 0.95 });

            for (let i = 0; i < 50; i++) {
                const pole = new THREE.Group();
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 10, 5), poleMat);
                post.position.y = 5;
                pole.add(post);
                // Crossbar
                const crossbar = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 0.2), poleMat);
                crossbar.position.y = 9.5;
                pole.add(crossbar);
                // Insulators
                for (let ix = -1.5; ix <= 1.5; ix += 1.5) {
                    const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 4),
                        new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.4, roughness: 0.3 }));
                    ins.position.set(ix, 9.8, 0);
                    pole.add(ins);
                }

                placeOnSurface(pole, r() * Math.PI * 2, (r() - 0.5) * STATION_LENGTH * 0.85, 2);
                group.add(pole);
            }
            sceneGroup.add(group);
        }

        // -- Corn / crop fields with height --
        function buildCropFields() {
            const group = new THREE.Group();
            const r = seededRandom(6789);
            const cornMat = new THREE.MeshStandardMaterial({ color: 0x8b9944, roughness: 0.95 });
            const wheatMat = new THREE.MeshStandardMaterial({ color: 0xc4a94e, roughness: 0.95 });

            for (let i = 0; i < 30; i++) {
                const angle = r() * Math.PI * 2;
                const z = (r() - 0.5) * STATION_LENGTH * 0.8;
                const isWheat = r() > 0.5;
                const fieldW = 30 + r() * 60;
                const fieldD = 30 + r() * 60;

                const fieldGeo = new THREE.BoxGeometry(fieldW, 1.5 + r() * 1.5, fieldD);
                const field = new THREE.Mesh(fieldGeo, isWheat ? wheatMat : cornMat);

                const px = Math.cos(angle) * (STATION_RADIUS - 2);
                const py = Math.sin(angle) * (STATION_RADIUS - 2);
                field.position.set(px, py, z);
                field.lookAt(0, 0, z);
                field.rotateX(Math.PI / 2);
                group.add(field);
            }
            sceneGroup.add(group);
        }
    function buildScene() {
      buildSkybox()
      buildGround()

      buildEndCaps()

      buildRoads()

      placeHousesOnSurface()

      placeTreesOnSurface()

      buildFences()
      buildPlaygrounds()
      buildSportsFields()

      buildAtmosphere()
      buildLampposts()
      buildCommunityStructures()

      buildCropFields()
      buildChurches()
      buildGasStations()

      buildParkingLots()
      buildSwimmingPools()
      buildVehiclesOnRoads()

      buildGreenhouses()
      buildSilos()
      buildBridges()

      buildPicnicAreas()
      buildPowerLines()

      setupLighting()
    }

    return {
      init({ root, camera, renderer, scene }) {
        rootRef = root
        sceneRef = scene
        cameraRef = camera
        rendererRef = renderer

        sceneGroup = new THREE.Group()
        sceneGroup.name = 'cooper-station-group'
        sceneGroup.position.z = STATION_EXTENSION_OFFSET_Z
        sceneGroup.rotation.z = stationSpinAngle
        rootRef.add(sceneGroup)

        previousFog = sceneRef.fog
        previousBackground = sceneRef.background
        previousToneMappingExposure =
          typeof rendererRef?.toneMappingExposure === 'number'
            ? rendererRef.toneMappingExposure
            : null
        previousCameraProjection = {
          near: cameraRef.near,
          far: cameraRef.far,
          fov: cameraRef.fov,
        }

        sceneRef.fog = new THREE.FogExp2(REFERENCE_SKY_COLOR, 0.00015)
        sceneRef.background = new THREE.Color(REFERENCE_SKY_COLOR)

        if (rendererRef) {
          rendererRef.toneMappingExposure = 1.1
        }

        cameraRef.near = 1
        cameraRef.far = 12000
        cameraRef.fov = 65
        cameraRef.position.copy(CAMERA_INIT_POSITION)
        cameraRef.lookAt(CAMERA_INIT_LOOK_AT)
        cameraRef.updateProjectionMatrix()

        buildScene()
      },

      update({ delta } = {}) {
        if (!cameraRef) {
          return
        }

        const safeDelta = Math.min(Math.max(delta ?? 1 / 60, 0), 0.05)
        stationSpinAngle = (stationSpinAngle + safeDelta * STATION_SPIN_SPEED) % (Math.PI * 2)
        if (sceneGroup) {
          sceneGroup.rotation.z = stationSpinAngle
        }

        cameraRef.position.copy(CAMERA_INIT_POSITION)
      },

      resize() {},

      dispose() {
        if (sceneGroup) {
          if (rootRef && sceneGroup.parent !== rootRef) {
            rootRef.add(sceneGroup)
          }
          disposeObject3D(sceneGroup)
        }

        if (sceneRef) {
          sceneRef.fog = previousFog
          sceneRef.background = previousBackground
        }

        if (rendererRef && previousToneMappingExposure !== null) {
          rendererRef.toneMappingExposure = previousToneMappingExposure
        }

        if (cameraRef && previousCameraProjection) {
          cameraRef.near = previousCameraProjection.near
          cameraRef.far = previousCameraProjection.far
          cameraRef.fov = previousCameraProjection.fov
          cameraRef.updateProjectionMatrix()
        }

        rootRef = null
        sceneRef = null
        cameraRef = null
        rendererRef = null
        sceneGroup = null
        previousFog = null
        previousBackground = null
        previousToneMappingExposure = null
        previousCameraProjection = null
        stationSpinAngle = 0
      },
    }
  },
}
