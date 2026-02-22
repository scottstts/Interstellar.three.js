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
const BLACK_HOLE_SCALE = 17
const BLACK_HOLE_POSITION = new THREE.Vector3(0, 1.2, -72)
const BLACK_HOLE_CAMERA_OFFSET = new THREE.Vector3(0, 2, 20)
const BLACK_HOLE_NOISE_TEXTURE_URL = '/textures/noise_deep.png'
const SPACE_BACKGROUND_COLOR = 0x02040a

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

export default {
  id: SCENE_ID,
  title: SCENE_TITLE,
  create() {
    let group = null
    let blackHole = null
    let noiseTexture = null
    let starsTexture = null
    let starfieldData = null
    let rootRef = null
    let previousBackground = null
    let previousEnvironment = null
    let disposed = false

    return {
      async init({ root, scene, camera }) {
        disposed = false
        rootRef = root

        group = new THREE.Group()
        group.name = `${SCENE_ID}-group`
        root.add(group)

        if (camera) {
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
      },

      update() {},

      resize() {},

      dispose({ scene }) {
        disposed = true

        if (scene) {
          scene.background = previousBackground ?? new THREE.Color(SPACE_BACKGROUND_COLOR)
          scene.environment = previousEnvironment ?? null
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
        starfieldData = null
        group = null
        rootRef = null
        previousBackground = null
        previousEnvironment = null
      },
    }
  },
}
