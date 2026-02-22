import * as THREE from 'three/webgpu'
import {
  Fn,
  If,
  Loop,
  abs,
  add,
  cameraPosition,
  clamp,
  color,
  cos,
  dot,
  equirectUV,
  faceDirection,
  float,
  fract,
  mat3,
  max,
  mix,
  modelWorldMatrix,
  mul,
  normalize,
  positionGeometry,
  positionWorld,
  pow,
  remapClamp,
  sin,
  step,
  sub,
  texture,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { disposeObject3D } from '../utils/dispose'

const SCENE_ID = 'gargantua-slingshot'
const SCENE_TITLE = 'Slingshot Around Gargantua'
const BLACK_HOLE_SCALE = 30
const BLACK_HOLE_POSITION = new THREE.Vector3(0, 1.2, -72)
const BLACK_HOLE_CAMERA_OFFSET = new THREE.Vector3(0, 4, 40)
const BLACK_HOLE_NOISE_TEXTURE_URL = '/textures/noise_deep.png'
const SPACE_BACKGROUND_COLOR = 0x02040a
const ENDURANCE_SCALE = 0.02
const ENDURANCE_POSITION = new THREE.Vector3(-7.5, 3, -43)
const ENDURANCE_LIGHT_COLOR = 0xffe3ad
const ENDURANCE_LIGHT_INTENSITY = 2.4
const ENDURANCE_LIGHT_LAYER = 1

const rotateAxis = Fn(([axisInput, angleInput]) => {
  const angle = float(angleInput).toVar()
  const axis = vec3(axisInput).toVar()
  const s = float(sin(angle)).toVar()
  const c = float(cos(angle)).toVar()
  const oc = float(sub(1.0, c)).toVar()

  return mat3(
    oc.mul(axis.x).mul(axis.x).add(c),
    oc.mul(axis.x).mul(axis.y).sub(axis.z.mul(s)),
    oc.mul(axis.z).mul(axis.x).add(axis.y.mul(s)),
    oc.mul(axis.x).mul(axis.y).add(axis.z.mul(s)),
    oc.mul(axis.y).mul(axis.y).add(c),
    oc.mul(axis.y).mul(axis.z).sub(axis.x.mul(s)),
    oc.mul(axis.z).mul(axis.x).sub(axis.y.mul(s)),
    oc.mul(axis.y).mul(axis.z).add(axis.x.mul(s)),
    oc.mul(axis.z).mul(axis.z).add(c)
  )
}).setLayout({
  name: 'rotateAxis',
  type: 'mat3',
  inputs: [
    { name: 'axis', type: 'vec3' },
    { name: 'angle', type: 'float' },
  ],
})

const srgbToLinear = Fn(([rgb]) => {
  return mix(
    rgb.div(12.92),
    pow(add(rgb, 0.055).div(1.055), vec3(2.4)),
    step(0.04045, rgb)
  )
})

const linearToSrgb = Fn(([lin]) => {
  const low = lin.mul(12.92)
  const high = pow(lin, vec3(1.0 / 2.4)).mul(1.055).sub(0.055)
  return mix(low, high, step(0.0031308, lin))
})

const vecToFac = Fn(([vector]) => {
  return vector.r.mul(0.2126).add(vector.g.mul(0.7152)).add(vector.b.mul(0.0722)).toVar()
})

const CatmulRom = Fn(([T, D, C, B, A]) => {
  return mul(
    0.5,
    mul(2.0, B)
      .add(A.negate().add(C).mul(T))
      .add(mul(2.0, A).sub(mul(5.0, B)).add(mul(4.0, C)).sub(D).mul(T).mul(T))
      .add(A.negate().add(mul(3.0, B)).sub(mul(3.0, C)).add(D).mul(T).mul(T).mul(T))
  )
}, { T: 'float', D: 'vec3', C: 'vec3', B: 'vec3', A: 'vec3', return: 'vec3' })

const ColorRamp3_BSpline = Fn(([T, A, B, C]) => {
  const AB = B.w.sub(A.w)
  const BC = C.w.sub(B.w)

  const iAB = T.sub(A.w).div(AB).saturate()
  const iBC = T.sub(B.w).div(BC).saturate()

  const p = vec3(sub(1.0, iAB), iAB.sub(iBC), iBC)

  const cA = CatmulRom(p.x, A.xyz, A.xyz, B.xyz, C.xyz)
  const cB = CatmulRom(p.y, A.xyz, B.xyz, C.xyz, C.xyz)
  const cC = C.xyz

  If(T.lessThan(B.w), () => {
    return cA.xyz
  })

  If(T.lessThan(C.w), () => {
    return cB.xyz
  })

  return cC.xyz
}, { T: 'float', A: 'vec4', B: 'vec4', C: 'vec4', return: 'vec3' })

const whiteNoise2D = (coord) => fract(sin(dot(coord, vec2(12.9898, 78.233))).mul(43758.5453))

const lengthSqrt = Fn(([v]) => {
  return v.x.mul(v.x).add(v.y.mul(v.y)).add(v.z.mul(v.z)).sqrt()
})

const smoothRange = Fn(([value, inMin, inMax, outMin, outMax]) => {
  const t = clamp(value.sub(inMin).div(inMax.sub(inMin)), 0.0, 1.0)
  const smoothT = t.mul(t).mul(float(3.0).sub(t.mul(2.0)))
  return mix(outMin, outMax, smoothT)
}, { value: 'float', inMin: 'float', inMax: 'float', outMin: 'float', outMax: 'float', return: 'float' })

function createBlackHole({ noiseTexture, starsTexture, scale = 5 }) {
  const group = new THREE.Group()

  const geometry = new THREE.SphereGeometry(1, 16, 16)
  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
  })

  const uniforms = {
    iterations: uniform(float(128)),
    stepSize: uniform(float(0.0071)),
    noiseFactor: uniform(float(0.01)),
    power: uniform(float(0.3)),
    clamp1: uniform(float(0.5)),
    clamp2: uniform(float(1.0)),
    originRadius: uniform(float(0.13)),
    width: uniform(float(0.03)),
    uvMotion: uniform(float(0)),
    // Interstellar palette: white-hot core -> golden mid-band -> amber outer falloff.
    rampCol1: uniform(color(1.0, 0.99, 0.95)),
    rampPos1: uniform(float(0.06)),
    rampCol2: uniform(color(1.0, 0.82, 0.34)),
    rampPos2: uniform(float(0.33)),
    rampCol3: uniform(color(0.42, 0.16, 0.02)),
    rampPos3: uniform(float(1)),
    rampEmission: uniform(float(1.95)),
    emissionColor: uniform(color(1.0, 0.72, 0.26)),
  }

  material.colorNode = Fn(() => {
    const _step = uniforms.stepSize
    const noiseAmp = uniforms.noiseFactor
    const power = uniforms.power
    const originRadius = uniforms.originRadius
    const bandWidth = uniforms.width
    const iterCount = uniforms.iterations

    const objCoords = positionGeometry.mul(vec3(1, 1, -1)).xzy
    const isBackface = step(0, faceDirection.negate())

    const camPointObj = cameraPosition.mul(modelWorldMatrix).mul(vec3(1, 1, -1)).xzy
    const startCoords = mix(objCoords, camPointObj.xyz, isBackface)

    const viewInWorld = normalize(sub(cameraPosition, positionWorld))
      .mul(vec3(1, 1, -1)).xzy
    const rayDir = viewInWorld.negate().toVar()

    const noiseWhite = whiteNoise2D(objCoords.xy).mul(noiseAmp)
    const jitter = rayDir.mul(noiseWhite)
    const rayPos = startCoords.sub(jitter).toVar()

    const colorAcc = vec3(0).toVar()
    const alphaAcc = float(0).toVar()

    Loop(iterCount, () => {
      const rNorm = normalize(rayPos)
      const rLen = lengthSqrt(rayPos)
      const steerMag = _step.mul(power).div(rLen.mul(rLen))
      const range = remapClamp(rLen, 1, 0.5, 0, 1)
      const steer = rNorm.mul(steerMag.mul(range))
      const steeredDir = rayDir.sub(steer).normalize()

      const advance = rayDir.mul(_step)
      rayPos.addAssign(advance)

      const xyLen = lengthSqrt(rayPos.mul(vec3(1, 1, 0)))
      const rotPhase = xyLen.mul(4.27).sub(time.mul(0.1))
      const uvAxis = vec3(0, 0, 1)
      const uvRot = rayPos.mul(rotateAxis(uvAxis, rotPhase))
      const uv = uvRot.mul(2)

      const noiseDeep = texture(noiseTexture, uv)

      const bandMin = bandWidth.negate()
      const bandEnds = vec3(bandMin, 0, bandWidth)
      const dz = sub(bandEnds, vec3(rayPos.z))
      const zQuad = dz.mul(dz).div(bandWidth)
      const zBand = max(bandWidth.sub(zQuad).div(bandWidth), 0)

      const noiseAmp3 = noiseDeep.mul(zBand)
      const noiseAmpLen = lengthSqrt(noiseAmp3)

      const uvForNormal = uv.mul(1.002)
      const noiseNormal = texture(noiseTexture, uvForNormal).mul(zBand)
      const noiseNormalLen = lengthSqrt(noiseNormal)

      const rampInput = xyLen
        .add(noiseAmpLen.sub(0.78).mul(1.5))
        .add(noiseAmpLen.sub(noiseNormalLen).mul(19.75))

      const rampA = vec4(uniforms.rampCol1, uniforms.rampPos1)
      const rampB = vec4(uniforms.rampCol2, uniforms.rampPos2)
      const rampC = vec4(uniforms.rampCol3, uniforms.rampPos3)

      const baseCol = ColorRamp3_BSpline(rampInput.x, rampA, rampB, rampC)
      const detailBoost = remapClamp(noiseNormalLen, 0.35, 1.2, 0.75, 1.15)
      const emissiveCol = baseCol.mul(uniforms.rampEmission.mul(detailBoost))
        .add(uniforms.emissionColor)

      const rLenNow = lengthSqrt(rayPos)
      const insideCore = rLenNow.lessThan(originRadius)
      const shadedCol = mix(emissiveCol, vec3(0), insideCore)

      const zAbs = abs(rayPos.z)
      const aNoise = noiseAmpLen.sub(0.75).mul(-0.6)
      const aPre = zAbs.add(aNoise)
      const aRadial = smoothRange(xyLen, 1, 0, 0, 1)
      const aBand = smoothRange(aPre, bandWidth, 0, 0, aRadial)
      const alphaLocal = mix(aBand, 1, insideCore)

      const oneMinusA = alphaAcc.oneMinus()
      const weight = oneMinusA.mul(vecToFac(alphaLocal))
      const newColor = mix(colorAcc, shadedCol, weight)
      const newAlpha = mix(alphaAcc, 1, vecToFac(alphaLocal))

      rayPos.addAssign(advance)
      rayDir.assign(steeredDir)
      colorAcc.assign(newColor)
      alphaAcc.assign(newAlpha)
    })

    const dirForEnv = rayDir.mul(vec3(1, -1, 1)).xzy
    const env = linearToSrgb(
      texture(starsTexture, equirectUV(dirForEnv)).mul(float(1))
    )

    const trans = float(1).sub(alphaAcc)
    const finalRGB = mix(colorAcc, env, trans.mul(1))

    return srgbToLinear(finalRGB)
  })()

  material.emissiveNode = material.colorNode
  material.needsUpdate = true

  const mesh = new THREE.Mesh(geometry, material)
  mesh.scale.setScalar(scale)
  mesh.frustumCulled = false
  group.add(mesh)

  return {
    group,
    material,
    uniforms,
  }
}

async function loadBlackHoleNoiseTexture() {
  const loader = new THREE.TextureLoader()
  const texture = await loader.loadAsync(BLACK_HOLE_NOISE_TEXTURE_URL)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.needsUpdate = true

  return texture
}

function createMulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function createStaticStarfieldData({
  starCount = 5200,
  baseRadius = 4200,
  seed = 0x11aa62f7,
} = {}) {
  const rng = createMulberry32(seed)
  const positions = new Float32Array(starCount * 3)
  const colors = new Float32Array(starCount * 3)
  const directions = new Float32Array(starCount * 3)
  const pi2 = Math.PI * 2

  for (let i = 0; i < starCount; i += 1) {
    const index = i * 3
    const y = rng() * 2 - 1
    const theta = rng() * pi2
    const sinPhi = Math.sqrt(Math.max(0, 1 - y * y))
    const x = sinPhi * Math.cos(theta)
    const z = sinPhi * Math.sin(theta)

    directions[index] = x
    directions[index + 1] = y
    directions[index + 2] = z

    positions[index] = x * baseRadius
    positions[index + 1] = y * baseRadius
    positions[index + 2] = z * baseRadius

    const brightnessBase = 0.14 + rng() * (0.98 - 0.14)
    const flicker = Math.pow(rng(), 1.1)
    const brightness = THREE.MathUtils.clamp(brightnessBase * (0.58 + flicker * 0.72), 0.06, 1.0)
    const warmth = -0.08 + rng() * 0.16

    colors[index] = THREE.MathUtils.clamp(brightness + warmth * 0.5, 0.04, 1.0)
    colors[index + 1] = THREE.MathUtils.clamp(brightness + warmth * 0.15, 0.04, 1.0)
    colors[index + 2] = THREE.MathUtils.clamp(brightness - warmth * 0.45, 0.04, 1.0)
  }

  return {
    colors,
    directions,
    positions,
    starCount,
  }
}

function createStarfieldTextureFromData(starfieldData, {
  width = 2048,
  height = 1024,
} = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Failed to create 2D context for static starfield texture.')
  }

  context.fillStyle = '#02040a'
  context.fillRect(0, 0, width, height)

  const pi2 = Math.PI * 2
  for (let i = 0; i < starfieldData.starCount; i += 1) {
    const index = i * 3
    const xDir = starfieldData.directions[index]
    const yDir = starfieldData.directions[index + 1]
    const zDir = starfieldData.directions[index + 2]

    const u = Math.atan2(zDir, xDir) / pi2 + 0.5
    const v = Math.acos(THREE.MathUtils.clamp(yDir, -1, 1)) / Math.PI

    const x = Math.floor(u * width) % width
    const y = Math.floor(v * height)

    const red = Math.floor(THREE.MathUtils.clamp(starfieldData.colors[index], 0, 1) * 255)
    const green = Math.floor(THREE.MathUtils.clamp(starfieldData.colors[index + 1], 0, 1) * 255)
    const blue = Math.floor(THREE.MathUtils.clamp(starfieldData.colors[index + 2], 0, 1) * 255)
    const brightness = (starfieldData.colors[index] + starfieldData.colors[index + 1] + starfieldData.colors[index + 2]) / 3
    const alpha = THREE.MathUtils.clamp(0.35 + brightness * 0.6, 0.3, 0.95)

    context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`
    context.fillRect(x, y, 1, 1)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.needsUpdate = true

  return texture
}

function setObjectLayerRecursive(object, layer) {
  object.layers.set(layer)
  object.traverse((child) => {
    child.layers.set(layer)
  })
}

function createMetalMat(hexColor, roughness, metalness) {
  const mat = new THREE.MeshStandardNodeMaterial()
  mat.colorNode = color(hexColor)
  mat.roughnessNode = float(roughness)
  mat.metalnessNode = float(metalness)
  return mat
}

function seededRand(seed) {
  const x = Math.sin(seed + 1) * 43758.5453
  return x - Math.floor(x)
}

function buildTornHalfPod({
  matDarkHull,
  matSolarPanel,
  matTornFace,
  matWhiteHull,
}) {
  const group = new THREE.Group()

  const hull = new THREE.Mesh(new THREE.BoxGeometry(8, 7, 5), matWhiteHull)
  hull.position.set(0, 0, -2.5)
  hull.castShadow = true
  hull.receiveShadow = true
  group.add(hull)

  const panel = new THREE.Mesh(new THREE.BoxGeometry(7.5, 6.5, 1), matSolarPanel)
  panel.position.set(0, 0, -4.6)
  panel.castShadow = true
  group.add(panel)

  const detail = new THREE.Mesh(new THREE.BoxGeometry(8.2, 2, 2.5), matDarkHull)
  detail.position.set(0, 0, -1.25)
  group.add(detail)

  {
    const NX = 16
    const NY = 14
    const xMin = -4.0
    const xMax = 4.0
    const yMin = -3.5
    const yMax = 3.5
    const verts = []
    const idxArr = []
    const vi = (ix, iy) => ix * (NY + 1) + iy

    for (let ix = 0; ix <= NX; ix += 1) {
      for (let iy = 0; iy <= NY; iy += 1) {
        const x = xMin + (ix / NX) * (xMax - xMin)
        const y = yMin + (iy / NY) * (yMax - yMin)

        let zOff = 0.05
        if (ix > 0 && ix < NX && iy > 0 && iy < NY) {
          const seed = ix * 31 + iy * 17
          const noise = Math.sin(ix * 2.1 + iy * 1.3) * 1.1
            + Math.cos(ix * 4.7 - iy * 2.9) * 0.7
            + (seededRand(seed) - 0.5) * 1.2
          zOff = 0.05 + Math.abs(noise)
        }

        verts.push(x, y, zOff)
      }
    }

    for (let ix = 0; ix < NX; ix += 1) {
      for (let iy = 0; iy < NY; iy += 1) {
        const a = vi(ix, iy)
        const b = vi(ix + 1, iy)
        const c = vi(ix + 1, iy + 1)
        const d = vi(ix, iy + 1)
        idxArr.push(a, b, c, a, c, d)
      }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    geo.setIndex(idxArr)
    geo.computeVertexNormals()

    const mesh = new THREE.Mesh(geo, matTornFace)
    mesh.castShadow = true
    group.add(mesh)
  }

  const numShards = 20
  for (let s = 0; s < numShards; s += 1) {
    const t = s / (numShards - 1)
    const angle = t * Math.PI * 2
    const x = Math.cos(angle) * 3.8
    const y = Math.sin(angle) * 3.3

    const r1 = seededRand(s * 7)
    const r2 = seededRand(s * 7 + 1)
    const r3 = seededRand(s * 7 + 2)
    const r4 = seededRand(s * 7 + 3)

    const shardW = 0.4 + r1 * 1.5
    const shardH = 0.3 + r2 * 1.2
    const shardD = 0.3 + r3 * 1.0
    const zOff = 0.1 + r4 * 1.5

    const shardGeo = new THREE.BoxGeometry(shardW, shardH, shardD)
    const shard = new THREE.Mesh(shardGeo, matWhiteHull)

    shard.position.set(x, y, zOff)
    shard.rotation.x = (r1 - 0.5) * 1.5
    shard.rotation.y = (r2 - 0.5) * 1.5
    shard.rotation.z = angle + (r3 - 0.5) * 0.5
    shard.castShadow = true
    group.add(shard)
  }

  return group
}

function createEnduranceWithRanger() {
  const matWhiteHull = createMetalMat(0xdddddd, 0.4, 0.6)
  const matDarkHull = createMetalMat(0x333333, 0.5, 0.7)
  const matSolarPanel = createMetalMat(0x111111, 0.15, 0.9)
  const matGlossBlack = createMetalMat(0x050505, 0.05, 0.8)
  const matStump = createMetalMat(0x222222, 0.9, 0.3)
  const matTornFace = createMetalMat(0x1a1a1a, 0.85, 0.45)

  const endurance = new THREE.Group()
  const RING_RADIUS = 32
  const NUM_MODULES = 12
  const IDX_BLOWN = 4
  const IDX_PARTIAL = 5

  for (let i = 0; i < NUM_MODULES; i += 1) {
    const angle = (i / NUM_MODULES) * Math.PI * 2
    const mx = Math.cos(angle) * RING_RADIUS
    const my = Math.sin(angle) * RING_RADIUS

    if (i === IDX_BLOWN) {
      const stumpGroup = new THREE.Group()
      const stump = new THREE.Mesh(new THREE.BoxGeometry(8, 7, 1.2), matStump)
      stump.castShadow = true
      stumpGroup.add(stump)

      const stumpShards = [
        { w: 0.8, h: 3.0, d: 0.35, x: 2.4, y: 1.8, z: 0.55, rx: 0.2, rz: 0.3 },
        { w: 0.5, h: 1.8, d: 0.3, x: -2.1, y: -2.2, z: 0.55, rx: -0.1, rz: -0.2 },
        { w: 0.9, h: 1.4, d: 0.35, x: 2.7, y: -1.3, z: 0.5, rx: 0.25, rz: 0.35 },
        { w: 0.4, h: 2.3, d: 0.28, x: -2.9, y: 1.0, z: 0.5, rx: -0.15, rz: -0.28 },
        { w: 0.7, h: 0.9, d: 0.4, x: 0.3, y: 2.7, z: 0.45, rx: 0.1, rz: 0.18 },
      ]

      stumpShards.forEach((s) => {
        const shard = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), matStump)
        shard.position.set(s.x, s.y, s.z)
        shard.rotation.set(s.rx, 0, s.rz)
        shard.castShadow = true
        stumpGroup.add(shard)
      })

      stumpGroup.position.set(mx, my, 0)
      stumpGroup.rotation.z = angle + Math.PI / 2
      stumpGroup.lookAt(0, 0, 0)
      endurance.add(stumpGroup)
    } else if (i === IDX_PARTIAL) {
      const modGroup = buildTornHalfPod({
        matDarkHull,
        matSolarPanel,
        matTornFace,
        matWhiteHull,
      })
      modGroup.position.set(mx, my, 0)
      modGroup.rotation.z = angle + Math.PI / 2
      modGroup.lookAt(0, 0, 0)
      modGroup.rotateY(Math.PI)
      endurance.add(modGroup)
    } else {
      const modGroup = new THREE.Group()

      const base = new THREE.Mesh(new THREE.BoxGeometry(8, 7, 10), matWhiteHull)
      base.castShadow = true
      base.receiveShadow = true
      modGroup.add(base)

      const innerPanel = new THREE.Mesh(new THREE.BoxGeometry(7.5, 6.5, 1), matSolarPanel)
      innerPanel.position.set(0, 0, -4.6)
      innerPanel.castShadow = true
      innerPanel.receiveShadow = true
      modGroup.add(innerPanel)

      const sideDetail = new THREE.Mesh(new THREE.BoxGeometry(8.2, 2, 4), matDarkHull)
      sideDetail.position.set(0, 0, 1)
      modGroup.add(sideDetail)

      modGroup.position.set(mx, my, 0)
      modGroup.rotation.z = angle + Math.PI / 2
      modGroup.lookAt(0, 0, 0)
      endurance.add(modGroup)
    }

    const jointAngle = angle + (Math.PI / NUM_MODULES)
    const jx = Math.cos(jointAngle) * RING_RADIUS
    const jy = Math.sin(jointAngle) * RING_RADIUS

    const jointGroup = new THREE.Group()
    jointGroup.position.set(jx, jy, 0)
    jointGroup.rotation.z = jointAngle

    const tube = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 9, 32), matWhiteHull)
    tube.castShadow = true
    tube.receiveShadow = true
    jointGroup.add(tube)

    const jointCenter = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 2.5, 32), matWhiteHull)
    jointGroup.add(jointCenter)

    const port = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3.5, 32), matGlossBlack)
    port.rotation.z = Math.PI / 2
    jointGroup.add(port)

    const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 3.2, 32), matDarkHull)
    rim.rotation.z = Math.PI / 2
    jointGroup.add(rim)

    endurance.add(jointGroup)
  }

  const poleLength = RING_RADIUS - 5
  const poleGroup = new THREE.Group()
  poleGroup.position.set(0, poleLength / 2 + 2, 0)

  const poleCore = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, poleLength, 32), matWhiteHull)
  poleCore.castShadow = true
  poleCore.receiveShadow = true
  poleGroup.add(poleCore)

  for (let i = -1; i <= 1; i += 1) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 2, 32), matDarkHull)
    ring.position.y = i * (poleLength / 3)
    poleGroup.add(ring)
  }
  endurance.add(poleGroup)

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 3, 32), matWhiteHull)
  hub.rotation.x = Math.PI / 2
  hub.castShadow = true
  hub.receiveShadow = true
  endurance.add(hub)

  const dockRing = new THREE.Mesh(new THREE.TorusGeometry(3, 0.5, 16, 64), matDarkHull)
  dockRing.position.z = 1.5
  endurance.add(dockRing)

  const ranger = new THREE.Group()
  ranger.scale.set(2, 2, 2)

  const fuseGeo = new THREE.ConeGeometry(4.5, 10, 4)
  fuseGeo.rotateY(Math.PI / 4)
  fuseGeo.rotateX(Math.PI / 2)
  fuseGeo.scale(1.1, 0.2, 1.0)
  ranger.add(new THREE.Mesh(fuseGeo, matWhiteHull))

  const underGeo = fuseGeo.clone()
  underGeo.scale(0.98, 0.5, 0.98)
  underGeo.translate(0, -0.15, 0)
  ranger.add(new THREE.Mesh(underGeo, matDarkHull))

  const cockpitBlock = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 3.5), matWhiteHull)
  cockpitBlock.position.set(0, 0.4, 0)
  cockpitBlock.rotation.x = Math.PI / 16
  cockpitBlock.castShadow = true
  ranger.add(cockpitBlock)

  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 1.5), matGlossBlack)
  canopy.position.set(0, 0.7, 1.2)
  canopy.rotation.x = Math.PI / 6
  ranger.add(canopy)

  const wingGeo = new THREE.BoxGeometry(3.5, 0.2, 4.0)

  const wingL = new THREE.Mesh(wingGeo, matWhiteHull)
  wingL.position.set(-2.8, 0, -2.5)
  wingL.rotation.y = Math.PI / 8
  wingL.castShadow = true
  ranger.add(wingL)

  const wingR = new THREE.Mesh(wingGeo, matWhiteHull)
  wingR.position.set(2.8, 0, -2.5)
  wingR.rotation.y = -Math.PI / 8
  wingR.castShadow = true
  ranger.add(wingR)

  const engines = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.0, 1.5), matDarkHull)
  engines.position.set(0, -0.1, -4.8)
  ranger.add(engines)

  ranger.position.set(0, -5, 3)
  ranger.rotateX(-300)
  endurance.add(ranger)

  endurance.rotation.x = -0.5
  endurance.rotation.y = -0.3

  return endurance
}

export default {
  id: SCENE_ID,
  title: SCENE_TITLE,
  create() {
    let group = null
    let blackHole = null
    let noiseTexture = null
    let starsTexture = null
    let starfieldData = null
    let endurance = null
    let rootRef = null
    let previousBackground = null
    let previousEnvironment = null
    let cameraRef = null
    let previousCameraLayerMask = null
    let disposed = false

    return {
      async init({ root, scene, camera }) {
        disposed = false
        rootRef = root
        cameraRef = camera ?? null

        group = new THREE.Group()
        group.name = `${SCENE_ID}-group`
        root.add(group)

        if (camera) {
          previousCameraLayerMask = camera.layers.mask
          camera.layers.enable(ENDURANCE_LIGHT_LAYER)
          camera.position.copy(BLACK_HOLE_POSITION).add(BLACK_HOLE_CAMERA_OFFSET)
          camera.lookAt(BLACK_HOLE_POSITION)
        }

        previousBackground = scene.background
        previousEnvironment = scene.environment

        starfieldData = createStaticStarfieldData()
        starsTexture = createStarfieldTextureFromData(starfieldData)
        scene.background = starsTexture
        scene.environment = starsTexture

        noiseTexture = await loadBlackHoleNoiseTexture()
        if (disposed) {
          if (noiseTexture) {
            noiseTexture.dispose()
            noiseTexture = null
          }
          return
        }

        blackHole = createBlackHole({
          noiseTexture,
          starsTexture,
          scale: BLACK_HOLE_SCALE,
        })
        blackHole.group.position.copy(BLACK_HOLE_POSITION)
        blackHole.group.rotation.z = THREE.MathUtils.degToRad(6)
        group.add(blackHole.group)

        endurance = createEnduranceWithRanger()
        endurance.scale.setScalar(ENDURANCE_SCALE)
        endurance.position.copy(ENDURANCE_POSITION)
        setObjectLayerRecursive(endurance, ENDURANCE_LIGHT_LAYER)
        group.add(endurance)

        const enduranceLightTarget = new THREE.Object3D()
        enduranceLightTarget.position.copy(ENDURANCE_POSITION)
        enduranceLightTarget.layers.set(ENDURANCE_LIGHT_LAYER)
        const enduranceKeyLight = new THREE.DirectionalLight(
          ENDURANCE_LIGHT_COLOR,
          ENDURANCE_LIGHT_INTENSITY
        )
        enduranceKeyLight.position.copy(BLACK_HOLE_POSITION)
        enduranceKeyLight.layers.set(ENDURANCE_LIGHT_LAYER)
        enduranceKeyLight.target = enduranceLightTarget
        group.add(enduranceKeyLight, enduranceLightTarget)
      },

      update() {},

      resize() {},

      dispose({ scene }) {
        disposed = true

        if (scene) {
          scene.background = previousBackground ?? new THREE.Color(SPACE_BACKGROUND_COLOR)
          scene.environment = previousEnvironment ?? null
        }

        if (cameraRef && previousCameraLayerMask !== null) {
          cameraRef.layers.mask = previousCameraLayerMask
        }

        if (group) {
          if (rootRef && group.parent !== rootRef) {
            rootRef.add(group)
          }
          disposeObject3D(group)
        }

        if (noiseTexture) {
          noiseTexture.dispose()
          noiseTexture = null
        }

        if (starsTexture) {
          starsTexture.dispose()
          starsTexture = null
        }

        blackHole = null
        endurance = null
        starfieldData = null
        group = null
        rootRef = null
        previousBackground = null
        previousEnvironment = null
        cameraRef = null
        previousCameraLayerMask = null
      },
    }
  },
}
