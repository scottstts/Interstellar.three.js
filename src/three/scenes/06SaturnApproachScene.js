import * as THREE from 'three/webgpu'
import {
  abs,
  cameraPosition,
  color,
  dot,
  exp,
  Fn,
  float,
  frontFacing,
  length,
  Loop,
  max,
  mix,
  min,
  normalize,
  normalLocal,
  positionWorld,
  pow,
  smoothstep,
  sqrt,
  step,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { disposeObject3D } from '../utils/dispose'

const WORLD_UNITS_PER_KM = 1
const WORLD_UNITS_PER_METER = WORLD_UNITS_PER_KM / 1000

// Saturn (approx. mean radius). World units are kilometers.
const SATURN_RADIUS_KM = 58232
const SATURN_ATMOSPHERE_HEIGHT_KM = 2500
const SATURN_RADIUS = SATURN_RADIUS_KM * WORLD_UNITS_PER_KM
const SATURN_SHELL_RADIUS = (SATURN_RADIUS_KM + SATURN_ATMOSPHERE_HEIGHT_KM) * WORLD_UNITS_PER_KM

const SATURN_RING_INNER_RADIUS_KM = 70000
const SATURN_RING_OUTER_RADIUS_KM = 140000
const SATURN_RING_INNER_RADIUS = SATURN_RING_INNER_RADIUS_KM * WORLD_UNITS_PER_KM
const SATURN_RING_OUTER_RADIUS = SATURN_RING_OUTER_RADIUS_KM * WORLD_UNITS_PER_KM

const SPACE_COLOR = new THREE.Color(0x02040a)
const STAR_COLOR = new THREE.Color(0xffffff)

const ATMOSPHERE_VIEW_SAMPLES = 18
const ATMOSPHERE_LIGHT_SAMPLES = 10
const ATMOSPHERE_VISUAL_THICKNESS_BOOST = 1.7

const CAMERA_FOV = 40
const CAMERA_NEAR = 0.06
const CAMERA_FAR = 520000

const SUN_DIRECTION = new THREE.Vector3(-0.86, 0.18, 0.47).normalize()

const MOVEMENT_KEY_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
  'ShiftLeft',
  'ShiftRight',
])

const TMP_VEC3_A = new THREE.Vector3()
const TMP_VEC3_B = new THREE.Vector3()
const TMP_VEC3_C = new THREE.Vector3()
const TMP_VEC3_D = new THREE.Vector3()
const ORIGIN = new THREE.Vector3(0, 0, 0)
const UP_VECTOR = new THREE.Vector3(0, 1, 0)

function metersToWorld(valueMeters) {
  return valueMeters * WORLD_UNITS_PER_METER
}

function clamp01(value) {
  return THREE.MathUtils.clamp(value, 0, 1)
}

function smoothstepRange(edge0, edge1, value) {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1
  }

  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function createSeededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 4294967296
  }
}

function createCanvasTexture({ width, height }, drawFn) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Could not create canvas context for procedural texture.')
  }

  drawFn(context, width, height)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.needsUpdate = true
  return texture
}

function createSaturnRingTexture() {
  const rng = createSeededRandom(607)

  return createCanvasTexture({ width: 2048, height: 256 }, (context, width, height) => {
    context.clearRect(0, 0, width, height)

    for (let x = 0; x < width; x += 1) {
      const t = x / (width - 1)

      const edgeInner = smoothstepRange(0.01, 0.06, t)
      const edgeOuter = 1 - smoothstepRange(0.94, 0.99, t)
      const envelope = edgeInner * edgeOuter

      const banding =
        0.52
        + 0.22 * Math.sin(t * 82 + 0.7)
        + 0.18 * Math.sin(t * 193 + 1.9)
        + 0.08 * Math.sin(t * 421 + 0.4)

      const fine = 0.12 * Math.sin(t * 1600 + 8.2) + 0.06 * Math.sin(t * 2400 + 1.1)
      const noise = (rng() - 0.5) * 0.1 + fine

      const cassiniDivision = 1 - smoothstepRange(0.615, 0.64, t) * (1 - smoothstepRange(0.64, 0.675, t))
      const innerGap = 1 - smoothstepRange(0.23, 0.255, t) * (1 - smoothstepRange(0.255, 0.275, t))

      let alpha = envelope * cassiniDivision * innerGap
      alpha *= THREE.MathUtils.clamp(banding + noise, 0.06, 1.1)

      // Tone down the innermost dusty region and brighten the A ring slightly.
      alpha *= THREE.MathUtils.lerp(0.52, 1.0, smoothstepRange(0.12, 0.42, t))
      alpha *= THREE.MathUtils.lerp(1.0, 1.15, smoothstepRange(0.72, 0.92, t))

      alpha = THREE.MathUtils.clamp(alpha, 0, 1)

      const warmth = THREE.MathUtils.lerp(0.92, 1.06, smoothstepRange(0.12, 0.9, t))
      const brightness = THREE.MathUtils.lerp(0.22, 0.98, alpha)

      const r = Math.floor(238 * brightness * warmth)
      const g = Math.floor(220 * brightness)
      const b = Math.floor(186 * brightness * 0.98)

      context.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`
      context.fillRect(x, 0, 1, height)
    }

    context.globalAlpha = 0.08
    context.fillStyle = '#000000'
    for (let i = 0; i < 1200; i += 1) {
      const x = Math.floor(rng() * width)
      const y = Math.floor(rng() * height)
      const w = 1 + Math.floor(rng() * 2)
      context.fillRect(x, y, w, 1)
    }
    context.globalAlpha = 1
  })
}

function applyPolarRingUVs(geometry, innerRadius, outerRadius) {
  const position = geometry.attributes.position
  const uv = new Float32Array(position.count * 2)
  const denom = Math.max(outerRadius - innerRadius, 1e-6)

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const y = position.getY(i)
    const angle = Math.atan2(y, x)
    const angle01 = (angle + Math.PI) / (Math.PI * 2)
    const radius = Math.sqrt(x * x + y * y)
    const radius01 = THREE.MathUtils.clamp((radius - innerRadius) / denom, 0, 1)

    const index = i * 2
    uv[index] = radius01
    uv[index + 1] = angle01
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geometry.attributes.uv.needsUpdate = true
}

function createSpaceStars() {
  const starCount = 7000
  const data = new Float32Array(starCount * 3)
  const colors = new Float32Array(starCount * 3)
  const radius = CAMERA_FAR * 0.86
  const tmpDir = new THREE.Vector3()

  for (let i = 0; i < starCount; i += 1) {
    const index = i * 3
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2))
    const theta = Math.random() * Math.PI * 2
    const sinPhi = Math.sin(phi)

    tmpDir.set(
      sinPhi * Math.cos(theta),
      Math.cos(phi),
      sinPhi * Math.sin(theta),
    )

    data[index] = tmpDir.x * radius
    data[index + 1] = tmpDir.y * radius
    data[index + 2] = tmpDir.z * radius

    const brightnessBase = THREE.MathUtils.randFloat(0.12, 1.05)
    const flicker = Math.pow(Math.random(), 1.05)
    const brightness = THREE.MathUtils.clamp(brightnessBase * (0.5 + flicker * 0.8), 0.04, 1.0)
    const warmth = THREE.MathUtils.randFloat(-0.09, 0.1)

    colors[index] = THREE.MathUtils.clamp(brightness + warmth * 0.5, 0.02, 1.0)
    colors[index + 1] = THREE.MathUtils.clamp(brightness + warmth * 0.15, 0.02, 1.0)
    colors[index + 2] = THREE.MathUtils.clamp(brightness - warmth * 0.45, 0.02, 1.0)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

  const material = new THREE.PointsMaterial({
    color: STAR_COLOR,
    size: 1.15,
    sizeAttenuation: false,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    vertexColors: true,
  })

  const stars = new THREE.Points(geometry, material)
  stars.name = 'scene06-space-stars'
  return stars
}

function scaleTriplet(values, factor) {
  return [values[0] * factor, values[1] * factor, values[2] * factor]
}

function getAtmosphereVisualHeightMultiplier(kind) {
  let base = 1.0
  switch (kind) {
    case 'terrestrial':
      base = 2.15
      break
    case 'rocky':
      base = 2.0
      break
    case 'gasGiant':
    case 'iceGiant':
      base = 1.35
      break
    default:
      base = 1.0
      break
  }

  return base * ATMOSPHERE_VISUAL_THICKNESS_BOOST
}

function estimateAtmosphereDensity(definition) {
  if (!definition.atmosphereHeightKm || definition.radiusKm <= 0) {
    return 0
  }

  const thicknessRatio = definition.atmosphereHeightKm / definition.radiusKm
  const kindBoost = definition.kind === 'terrestrial' ? 1.0 : definition.kind === 'rocky' ? 0.55 : 0.8
  return THREE.MathUtils.clamp(thicknessRatio * 11.5 * kindBoost, 0.2, 1.3)
}

function createStellarAtmosphereModel(definition, renderScale) {
  const thicknessKm = Math.max(definition.atmosphereHeightKm ?? 0, 1)
  const density = THREE.MathUtils.clamp(
    definition.atmosphereDensity ?? estimateAtmosphereDensity(definition),
    0.15,
    1.8,
  )
  const terrestrialDensityN = THREE.MathUtils.clamp((density - 0.25) / 1.35, 0, 1)
  const visualHeightMultiplier = getAtmosphereVisualHeightMultiplier(definition.kind)

  let profile = {
    rayleighScatteringKm: [0.0058, 0.0135, 0.0331],
    mieScatteringKm: [0.0022, 0.0022, 0.0022],
    mieExtinctionKm: [0.0032, 0.0032, 0.0032],
    rayleighScaleHeightKm: THREE.MathUtils.lerp(7.2, 10.8, terrestrialDensityN),
    upperRayleighScaleHeightKm: Math.max(36.0, thicknessKm * 0.36 * visualHeightMultiplier),
    upperRayleighStrength: 0.04,
    mieScaleHeightKm: THREE.MathUtils.lerp(0.9, 1.7, terrestrialDensityN),
    miePhaseG: 0.76,
    ozoneExtinctionKm: [0.00065, 0.001881, 0.000085],
    ozoneCenterHeightKm: Math.min(thicknessKm * 0.42, 26),
    ozoneWidthKm: Math.max(6, Math.min(thicknessKm * 0.18, 14)),
    solarIntensity: 13.8,
  }

  if (definition.kind === 'rocky') {
    profile = {
      rayleighScatteringKm: [0.0044, 0.0104, 0.024],
      mieScatteringKm: [0.0015, 0.0015, 0.0015],
      mieExtinctionKm: [0.0024, 0.0024, 0.0024],
      rayleighScaleHeightKm: Math.max(3.6, Math.min(thicknessKm * 0.11, 6.2)),
      upperRayleighScaleHeightKm: Math.max(16.0, thicknessKm * 0.28 * visualHeightMultiplier),
      upperRayleighStrength: 0.032,
      mieScaleHeightKm: Math.max(0.4, Math.min(thicknessKm * 0.035, 0.95)),
      miePhaseG: 0.71,
      ozoneExtinctionKm: [0.0, 0.0, 0.0],
      ozoneCenterHeightKm: thicknessKm * 0.45,
      ozoneWidthKm: Math.max(3.5, thicknessKm * 0.14),
      solarIntensity: 11.6,
    }
  } else if (definition.kind === 'gasGiant' || definition.kind === 'iceGiant') {
    const isGas = definition.kind === 'gasGiant'
    profile = {
      rayleighScatteringKm: isGas ? [0.0016, 0.0031, 0.0058] : [0.0021, 0.0045, 0.0093],
      mieScatteringKm: isGas ? [0.0022, 0.0022, 0.0022] : [0.0019, 0.0019, 0.0019],
      mieExtinctionKm: isGas ? [0.0032, 0.0032, 0.0032] : [0.0028, 0.0028, 0.0028],
      rayleighScaleHeightKm: Math.max(20, thicknessKm * 0.09),
      upperRayleighScaleHeightKm: Math.max(64, thicknessKm * 0.26 * visualHeightMultiplier),
      upperRayleighStrength: isGas ? 0.02 : 0.024,
      mieScaleHeightKm: Math.max(6, thicknessKm * 0.026),
      miePhaseG: isGas ? 0.82 : 0.8,
      ozoneExtinctionKm: [0.0, 0.0, 0.0],
      ozoneCenterHeightKm: thicknessKm * 0.65,
      ozoneWidthKm: Math.max(12, thicknessKm * 0.22),
      solarIntensity: isGas ? 10 : 10.8,
    }
  }

  const rayleighDensityScale = definition.kind === 'rocky' ? density * 0.78 : density
  const mieDensityScale = definition.kind === 'terrestrial' ? density * 1.02 : density * 0.9

  const rayleighScatteringKm = scaleTriplet(profile.rayleighScatteringKm, rayleighDensityScale)
  const mieScatteringKm = scaleTriplet(profile.mieScatteringKm, mieDensityScale)
  const mieExtinctionRawKm = scaleTriplet(profile.mieExtinctionKm, mieDensityScale)
  const mieExtinctionKm = [
    Math.max(mieExtinctionRawKm[0], mieScatteringKm[0] + 0.0001),
    Math.max(mieExtinctionRawKm[1], mieScatteringKm[1] + 0.0001),
    Math.max(mieExtinctionRawKm[2], mieScatteringKm[2] + 0.0001),
  ]
  const ozoneExtinctionKm = scaleTriplet(
    profile.ozoneExtinctionKm ?? [0, 0, 0],
    definition.kind === 'terrestrial' ? density : 1,
  )

  const worldUnitsPerKm = renderScale
  const inverseWorldUnitsPerKm = 1 / Math.max(worldUnitsPerKm, 1e-6)

  return {
    rayleighScatteringWorld: scaleTriplet(rayleighScatteringKm, inverseWorldUnitsPerKm),
    mieScatteringWorld: scaleTriplet(mieScatteringKm, inverseWorldUnitsPerKm),
    mieExtinctionWorld: scaleTriplet(mieExtinctionKm, inverseWorldUnitsPerKm),
    ozoneExtinctionWorld: scaleTriplet(ozoneExtinctionKm, inverseWorldUnitsPerKm),
    rayleighScaleHeightWorld: Math.max(profile.rayleighScaleHeightKm * worldUnitsPerKm, 1e-5),
    upperRayleighScaleHeightWorld: Math.max(
      (profile.upperRayleighScaleHeightKm ?? profile.rayleighScaleHeightKm * 2.6) * worldUnitsPerKm,
      1e-5,
    ),
    upperRayleighStrength: THREE.MathUtils.clamp(profile.upperRayleighStrength ?? 0.05, 0.0, 0.24),
    mieScaleHeightWorld: Math.max(profile.mieScaleHeightKm * worldUnitsPerKm, 1e-5),
    ozoneCenterHeightWorld: Math.max((profile.ozoneCenterHeightKm ?? 0) * worldUnitsPerKm, 0),
    ozoneWidthWorld: Math.max((profile.ozoneWidthKm ?? 1) * worldUnitsPerKm, 1e-5),
    miePhaseG: THREE.MathUtils.clamp(profile.miePhaseG, 0, 0.92),
    solarIntensity: profile.solarIntensity ?? 18,
  }
}

function createStellarAtmosphereMaterial(
  sunDirectionWorld,
  atmosphereCenterWorld,
  bodyRadiusWorld,
  atmosphereRadiusWorld,
  shellOpacity,
  frontFaceOpacity,
  backFaceOpacity,
  model,
) {
  const betaRayleigh = vec3(
    model.rayleighScatteringWorld[0],
    model.rayleighScatteringWorld[1],
    model.rayleighScatteringWorld[2],
  )
  const betaMieScattering = vec3(model.mieScatteringWorld[0], model.mieScatteringWorld[1], model.mieScatteringWorld[2])
  const betaMieExtinction = vec3(model.mieExtinctionWorld[0], model.mieExtinctionWorld[1], model.mieExtinctionWorld[2])
  const betaOzone = vec3(model.ozoneExtinctionWorld[0], model.ozoneExtinctionWorld[1], model.ozoneExtinctionWorld[2])

  const rayleighScaleHeight = float(model.rayleighScaleHeightWorld)
  const upperRayleighScaleHeight = float(model.upperRayleighScaleHeightWorld)
  const upperRayleighStrength = float(model.upperRayleighStrength)
  const mieScaleHeight = float(model.mieScaleHeightWorld)
  const ozoneCenterHeight = float(model.ozoneCenterHeightWorld)
  const ozoneWidth = float(model.ozoneWidthWorld)
  const mieG = float(model.miePhaseG)
  const solarIntensity = float(model.solarIntensity)

  const atmosphereOutput = Fn(() => {
    const rayOrigin = cameraPosition
    const rayDirection = normalize(positionWorld.sub(cameraPosition))
    const sunDirection = normalize(sunDirectionWorld)
    const planetCenter = atmosphereCenterWorld
    const bottomRadius = bodyRadiusWorld
    const topRadius = atmosphereRadiusWorld
    const atmosphereThickness = max(topRadius.sub(bottomRadius), bottomRadius.mul(0.005))
    const topEdgeFadeRange = atmosphereThickness.mul(0.24)
    const grazingFadeRange = atmosphereThickness.mul(0.16)

    const oc = rayOrigin.sub(planetCenter)

    const bAtmosphere = dot(oc, rayDirection)
    const cAtmosphere = dot(oc, oc).sub(topRadius.mul(topRadius))
    const hAtmosphere = bAtmosphere.mul(bAtmosphere).sub(cAtmosphere)
    const atmosphereHit = step(0.0, hAtmosphere)
    const atmosphereSqrt = sqrt(max(hAtmosphere, 0.0))
    const atmosphereIntersection = vec2(
      bAtmosphere.negate().sub(atmosphereSqrt),
      bAtmosphere.negate().add(atmosphereSqrt),
    )

    const bGround = dot(oc, rayDirection)
    const cGround = dot(oc, oc).sub(bottomRadius.mul(bottomRadius))
    const hGround = bGround.mul(bGround).sub(cGround)
    const groundHitValid = step(0.0, hGround)
    const groundSqrt = sqrt(max(hGround, 0.0))
    const groundIntersection = vec2(bGround.negate().sub(groundSqrt), bGround.negate().add(groundSqrt))
    const hitsGround = step(0.0, groundIntersection.x).mul(groundHitValid)

    const tStart = max(atmosphereIntersection.x, 0.0).mul(atmosphereHit)
    const tEnd = max(mix(atmosphereIntersection.y, min(atmosphereIntersection.y, groundIntersection.x), hitsGround), 0.0)
      .mul(atmosphereHit)

    const rayLength = max(tEnd.sub(tStart), 0.0)
    const stepSize = rayLength.div(float(ATMOSPHERE_VIEW_SAMPLES))
    const hasAtmosphereSegment = smoothstep(0.0, grazingFadeRange, rayLength)

    const mu = dot(rayDirection, sunDirection)
    const phaseRayleigh = float(0.05968310365946075).mul(float(1.0).add(mu.mul(mu)))
    const g2 = mieG.mul(mieG)
    const phaseMie = float(0.07957747154594767)
      .mul(float(1.0).sub(g2))
      .div(pow(float(1.0).add(g2).sub(float(2.0).mul(mieG).mul(mu)), 1.5))

    const opticalDepthR = float(0.0).toVar()
    const opticalDepthM = float(0.0).toVar()
    const opticalDepthOzone = float(0.0).toVar()
    const inScatteredRadiance = vec3(0.0, 0.0, 0.0).toVar()

    Loop(ATMOSPHERE_VIEW_SAMPLES, ({ i }) => {
      const t = tStart.add(stepSize.mul(float(i).add(0.5)))
      const samplePosition = rayOrigin.add(rayDirection.mul(t))
      const sampleToCenter = samplePosition.sub(planetCenter)
      const sampleRadius = length(sampleToCenter)
      const sampleHeight = sampleRadius.sub(bottomRadius)
      const aboveSurface = step(0.0, sampleHeight)
      const safeHeight = max(sampleHeight, 0.0)
      const topDistance = max(topRadius.sub(sampleRadius), 0.0)
      const topFade = smoothstep(0.0, topEdgeFadeRange, topDistance)

      const densityRMain = exp(safeHeight.negate().div(rayleighScaleHeight))
      const densityRUpper = exp(safeHeight.negate().div(upperRayleighScaleHeight)).mul(upperRayleighStrength)
      const densityR = densityRMain.add(densityRUpper).mul(aboveSurface).mul(topFade)
      const densityM = exp(safeHeight.negate().div(mieScaleHeight)).mul(aboveSurface).mul(topFade)
      const ozoneBand = max(float(1.0).sub(abs(safeHeight.sub(ozoneCenterHeight)).div(ozoneWidth)), 0.0)
        .mul(aboveSurface)
        .mul(topFade)

      opticalDepthR.addAssign(densityR.mul(stepSize))
      opticalDepthM.addAssign(densityM.mul(stepSize))
      opticalDepthOzone.addAssign(ozoneBand.mul(stepSize))

      const sunAtmosphereB = dot(sampleToCenter, sunDirection)
      const sunAtmosphereC = dot(sampleToCenter, sampleToCenter).sub(topRadius.mul(topRadius))
      const sunAtmosphereH = sunAtmosphereB.mul(sunAtmosphereB).sub(sunAtmosphereC)
      const sunAtmosphereHit = step(0.0, sunAtmosphereH)
      const sunAtmosphereSqrt = sqrt(max(sunAtmosphereH, 0.0))
      const sunAtmosphereIntersection = vec2(
        sunAtmosphereB.negate().sub(sunAtmosphereSqrt),
        sunAtmosphereB.negate().add(sunAtmosphereSqrt),
      )
      const sunTStart = max(sunAtmosphereIntersection.x, 0.0).mul(sunAtmosphereHit)
      const sunTRange = max(sunAtmosphereIntersection.y.sub(sunTStart), 0.0).mul(sunAtmosphereHit)
      const sunStepSize = sunTRange.div(float(ATMOSPHERE_LIGHT_SAMPLES))

      const shadowB = dot(sampleToCenter, sunDirection)
      const shadowC = dot(sampleToCenter, sampleToCenter).sub(bottomRadius.mul(bottomRadius))
      const shadowH = shadowB.mul(shadowB).sub(shadowC)
      const shadowHit = step(0.0, shadowH)
      const shadowSqrt = sqrt(max(shadowH, 0.0))
      const shadowNear = shadowB.negate().sub(shadowSqrt)
      const sunVisible = float(1.0).sub(step(0.0, shadowNear).mul(shadowHit))

      const sunDepthR = float(0.0).toVar()
      const sunDepthM = float(0.0).toVar()
      const sunDepthOzone = float(0.0).toVar()

      Loop(ATMOSPHERE_LIGHT_SAMPLES, ({ i: j }) => {
        const sunT = sunTStart.add(sunStepSize.mul(float(j).add(0.5)))
        const sunSamplePosition = samplePosition.add(sunDirection.mul(sunT))
        const sunSampleRadius = length(sunSamplePosition.sub(planetCenter))
        const sunHeight = sunSampleRadius.sub(bottomRadius)
        const sunAboveSurface = step(0.0, sunHeight)
        const safeSunHeight = max(sunHeight, 0.0)
        const sunTopDistance = max(topRadius.sub(sunSampleRadius), 0.0)
        const sunTopFade = smoothstep(0.0, topEdgeFadeRange, sunTopDistance)

        const sunDensityRMain = exp(safeSunHeight.negate().div(rayleighScaleHeight))
        const sunDensityRUpper = exp(safeSunHeight.negate().div(upperRayleighScaleHeight)).mul(upperRayleighStrength)
        sunDepthR.addAssign(sunDensityRMain.add(sunDensityRUpper).mul(sunStepSize).mul(sunAboveSurface).mul(sunTopFade))
        sunDepthM.addAssign(
          exp(safeSunHeight.negate().div(mieScaleHeight)).mul(sunStepSize).mul(sunAboveSurface).mul(sunTopFade),
        )
        sunDepthOzone.addAssign(
          max(float(1.0).sub(abs(safeSunHeight.sub(ozoneCenterHeight)).div(ozoneWidth)), 0.0)
            .mul(sunStepSize)
            .mul(sunAboveSurface)
            .mul(sunTopFade),
        )
      })

      const tauView = betaRayleigh
        .mul(opticalDepthR)
        .add(betaMieExtinction.mul(opticalDepthM))
        .add(betaOzone.mul(opticalDepthOzone))
      const tauSun = betaRayleigh.mul(sunDepthR).add(betaMieExtinction.mul(sunDepthM)).add(betaOzone.mul(sunDepthOzone))
      const transmittance = exp(tauView.add(tauSun).negate()).mul(sunVisible)

      const scattering = betaRayleigh
        .mul(densityR.mul(phaseRayleigh))
        .add(betaMieScattering.mul(densityM.mul(phaseMie)))

      inScatteredRadiance.addAssign(scattering.mul(transmittance).mul(stepSize))
    })

    const tauViewTotal = betaRayleigh
      .mul(opticalDepthR)
      .add(betaMieExtinction.mul(opticalDepthM))
      .add(betaOzone.mul(opticalDepthOzone))
    const viewTransmittance = exp(tauViewTotal.negate())

    const multiScatterApprox = vec3(1.0, 1.0, 1.0)
      .sub(viewTransmittance)
      .mul(betaRayleigh.mul(0.018).add(betaMieScattering.mul(0.0035)))
      .mul(solarIntensity.mul(0.38))

    const skyRadianceRaw = inScatteredRadiance.mul(solarIntensity).add(multiScatterApprox).mul(hasAtmosphereSegment)
    const skyRadiance = skyRadianceRaw.div(skyRadianceRaw.mul(0.22).add(vec3(1.0, 1.0, 1.0)))
    const transmittanceLuma = dot(viewTransmittance, vec3(0.2126, 0.7152, 0.0722)).clamp(0.0, 1.0)
    const faceOpacity = frontFacing.select(frontFaceOpacity, backFaceOpacity)
    const opacity = pow(float(1.0).sub(transmittanceLuma), 1.15)
      .mul(hasAtmosphereSegment)
      .mul(shellOpacity)
      .mul(faceOpacity)
      .clamp(0.0, 1.0)

    return vec4(skyRadiance, opacity)
  })

  const material = new THREE.MeshBasicNodeMaterial()
  material.outputNode = atmosphereOutput()
  material.transparent = true
  material.premultipliedAlpha = false
  material.depthWrite = false
  material.depthTest = true
  material.side = THREE.DoubleSide
  material.blending = THREE.NormalBlending
  return material
}

function createSaturnSystem({ ringTexture, saturnTexture }) {
  const group = new THREE.Group()
  group.name = 'scene06-saturn-system'

  const saturnMaterial = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 0.98,
  })
  const saturnTextureNode = texture(saturnTexture)
  const poleMask = smoothstep(0.9, 0.975, abs(normalLocal.y))
  saturnMaterial.colorNode = mix(saturnTextureNode.rgb, color(0xc9bea9), poleMask)

  const saturn = new THREE.Mesh(new THREE.SphereGeometry(SATURN_RADIUS, 168, 112), saturnMaterial)
  saturn.name = 'scene06-saturn'
  saturn.receiveShadow = true
  group.add(saturn)

  const ringsMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: ringTexture,
    metalness: 0.08,
    roughness: 0.88,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  ringsMaterial.alphaTest = 0.01

  const ringsGeometry = new THREE.RingGeometry(SATURN_RING_INNER_RADIUS, SATURN_RING_OUTER_RADIUS, 420, 1)
  applyPolarRingUVs(ringsGeometry, SATURN_RING_INNER_RADIUS, SATURN_RING_OUTER_RADIUS)

  const rings = new THREE.Mesh(ringsGeometry, ringsMaterial)
  rings.name = 'scene06-saturn-rings'
  rings.rotation.x = Math.PI / 2
  // Render after the atmosphere shell to avoid the shell over-blending on top of the rings.
  rings.renderOrder = 20
  group.add(rings)

  const atmosphereModel = createStellarAtmosphereModel(
    {
      atmosphereDensity: 0.72,
      atmosphereHeightKm: SATURN_ATMOSPHERE_HEIGHT_KM,
      kind: 'gasGiant',
      radiusKm: SATURN_RADIUS_KM,
    },
    WORLD_UNITS_PER_KM,
  )
  const atmosphereShellOpacity = uniform(1)
  const atmosphereFrontFaceOpacity = uniform(1)
  const atmosphereBackFaceOpacity = uniform(0.0)
  const atmosphereMaterial = createStellarAtmosphereMaterial(
    uniform(SUN_DIRECTION.clone()),
    uniform(new THREE.Vector3(0, 0, 0)),
    uniform(SATURN_RADIUS),
    uniform(SATURN_SHELL_RADIUS),
    atmosphereShellOpacity,
    atmosphereFrontFaceOpacity,
    atmosphereBackFaceOpacity,
    atmosphereModel,
  )

  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(SATURN_SHELL_RADIUS, 128, 88), atmosphereMaterial)
  atmosphere.name = 'scene06-saturn-atmosphere'
  atmosphere.renderOrder = 10
  group.add(atmosphere)

  group.rotation.x = THREE.MathUtils.degToRad(26.7)
  group.rotation.z = THREE.MathUtils.degToRad(12)

  return {
    atmosphere,
    group,
    rings,
    saturn,
  }
}

function createMetalMat(hexColor, roughness, metalness) {
  const material = new THREE.MeshStandardNodeMaterial()
  material.colorNode = color(hexColor)
  material.roughnessNode = float(roughness)
  material.metalnessNode = float(metalness)
  return material
}

function createDockedEndurance() {
  const docked = new THREE.Group()
  docked.name = 'scene06-docked-endurance'

  const endurance = new THREE.Group()
  endurance.name = 'scene06-endurance'

  const matWhiteHull = createMetalMat(0xdddddd, 0.4, 0.6)
  const matDarkHull = createMetalMat(0x333333, 0.5, 0.7)
  const matSolarPanel = createMetalMat(0x111111, 0.15, 0.9)
  const matGlossBlack = createMetalMat(0x050505, 0.05, 0.8)

  const RING_RADIUS = 32
  const NUM_MODULES = 12

  for (let i = 0; i < NUM_MODULES; i += 1) {
    const angle = (i / NUM_MODULES) * Math.PI * 2
    const modGroup = new THREE.Group()

    const baseGeo = new THREE.BoxGeometry(8, 7, 10)
    const base = new THREE.Mesh(baseGeo, matWhiteHull)
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

    modGroup.position.set(Math.cos(angle) * RING_RADIUS, Math.sin(angle) * RING_RADIUS, 0)
    modGroup.rotation.z = angle + Math.PI / 2
    modGroup.lookAt(0, 0, 0)
    endurance.add(modGroup)

    const jointAngle = angle + (Math.PI / NUM_MODULES)
    const jointGroup = new THREE.Group()
    jointGroup.position.set(Math.cos(jointAngle) * RING_RADIUS, Math.sin(jointAngle) * RING_RADIUS, 0)
    jointGroup.rotation.z = jointAngle

    const tube = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 9, 32), matWhiteHull)
    tube.castShadow = true
    tube.receiveShadow = true
    jointGroup.add(tube)

    const jointCenter = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 2.5, 32), matWhiteHull)
    jointGroup.add(jointCenter)

    const portGeo = new THREE.CylinderGeometry(1.2, 1.2, 3.5, 32)
    const port = new THREE.Mesh(portGeo, matGlossBlack)
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
  ranger.name = 'scene06-ranger'

  const fuseGeo = new THREE.ConeGeometry(4.5, 10, 4)
  fuseGeo.rotateY(Math.PI / 4)
  fuseGeo.rotateX(Math.PI / 2)
  fuseGeo.scale(1.1, 0.2, 1.0)

  const fuseBase = new THREE.Mesh(fuseGeo, matWhiteHull)
  fuseBase.castShadow = true
  fuseBase.receiveShadow = true
  ranger.add(fuseBase)

  const underGeo = fuseGeo.clone()
  underGeo.scale(0.98, 0.5, 0.98)
  underGeo.translate(0, -0.15, 0)
  const under = new THREE.Mesh(underGeo, matDarkHull)
  under.castShadow = true
  ranger.add(under)

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

  ranger.position.set(0, 0, 7.5)
  ranger.rotation.set(0, 0, 0)
  endurance.add(ranger)

  endurance.scale.setScalar(WORLD_UNITS_PER_METER)
  docked.add(endurance)

  docked.rotation.set(0.62, -0.12, 0.94)
  return { docked }
}

export default {
  id: 'endurance-saturn-approach',
  title: 'Endurance Near Saturn',
  create() {
    let rootRef = null
    let sceneGroup = null
    let stars = null
    let saturnSystem = null
    let dockedEndurance = null
    let sunLight = null
    let fillLight = null

    let savedCameraNear = 0
    let savedCameraFar = 0
    let savedCameraFov = 0
    let savedBackground = null

    let pointerLockBlockHandler = null
    let movementKeyBlockHandler = null

    const state = {
      orbitAngle: -0.5,
      shipSpinRate: 0.15,
      flybyProgress: 0.14,
      flybyDuration: 22,
      cameraBasePosition: new THREE.Vector3(),
      cameraBaseQuaternion: new THREE.Quaternion(),
      cameraForward: new THREE.Vector3(),
      cameraRight: new THREE.Vector3(),
      cameraUp: new THREE.Vector3(),
      shipAnchorPosition: new THREE.Vector3(),
    }

    function positionCamera(camera) {
      if (!dockedEndurance || !saturnSystem) {
        return
      }

      TMP_VEC3_A.copy(dockedEndurance.position).normalize()
      TMP_VEC3_B.crossVectors(UP_VECTOR, TMP_VEC3_A).normalize()
      TMP_VEC3_C.copy(TMP_VEC3_A).multiplyScalar(metersToWorld(1600))
      TMP_VEC3_C.addScaledVector(TMP_VEC3_B, metersToWorld(-1250))
      TMP_VEC3_C.addScaledVector(UP_VECTOR, metersToWorld(650))

      camera.position.copy(dockedEndurance.position).add(TMP_VEC3_C)

      TMP_VEC3_D.copy(dockedEndurance.position).lerp(ORIGIN, 0.08)
      camera.lookAt(TMP_VEC3_D)
    }

    function setShipAnchorPosition() {
      if (!dockedEndurance || !saturnSystem) {
        return
      }

      TMP_VEC3_A.set(
        Math.cos(state.orbitAngle) * (SATURN_RING_OUTER_RADIUS * 1.08),
        SATURN_RADIUS * 0.11,
        Math.sin(state.orbitAngle) * (SATURN_RING_OUTER_RADIUS * 1.08),
      )

      saturnSystem.group.localToWorld(TMP_VEC3_A)
      state.shipAnchorPosition.copy(TMP_VEC3_A)
    }

    return {
      async init({ camera, renderer, root, scene }) {
        rootRef = root
        sceneGroup = new THREE.Group()
        sceneGroup.name = 'scene06-group'
        root.add(sceneGroup)

        savedCameraNear = camera.near
        savedCameraFar = camera.far
        savedCameraFov = camera.fov
        camera.near = CAMERA_NEAR
        camera.far = CAMERA_FAR
        camera.fov = CAMERA_FOV
        camera.updateProjectionMatrix()

        if (scene.background && scene.background.isColor) {
          savedBackground = scene.background.clone()
        } else {
          savedBackground = null
        }
        scene.background = SPACE_COLOR.clone()

        fillLight = new THREE.AmbientLight(0x1d2430, 0.18)
        sunLight = new THREE.DirectionalLight(0xfff1d6, 2.6)
        sunLight.position.copy(SUN_DIRECTION).multiplyScalar(200000)
        sceneGroup.add(fillLight, sunLight, sunLight.target)

        const textureLoader = new THREE.TextureLoader()
        const saturnTexture = await textureLoader.loadAsync('/textures/saturn_texture.jpg')
        saturnTexture.colorSpace = THREE.SRGBColorSpace
        saturnTexture.wrapS = THREE.RepeatWrapping
        saturnTexture.wrapT = THREE.ClampToEdgeWrapping
        saturnTexture.center.set(0.5, 0.5)
        saturnTexture.rotation = 0
        saturnTexture.generateMipmaps = true
        if (renderer?.capabilities && typeof renderer.capabilities.getMaxAnisotropy === 'function') {
          saturnTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
        }
        saturnTexture.needsUpdate = true

        const ringTexture = createSaturnRingTexture()
        if (renderer?.capabilities && typeof renderer.capabilities.getMaxAnisotropy === 'function') {
          ringTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
        }
        ringTexture.needsUpdate = true

        saturnSystem = createSaturnSystem({ ringTexture, saturnTexture })
        sceneGroup.add(saturnSystem.group)
        saturnSystem.group.updateMatrixWorld(true)

        stars = createSpaceStars()
        sceneGroup.add(stars)

        dockedEndurance = createDockedEndurance().docked
        sceneGroup.add(dockedEndurance)

        setShipAnchorPosition()
        dockedEndurance.position.copy(state.shipAnchorPosition)
        positionCamera(camera)

        state.cameraBasePosition.copy(camera.position)
        state.cameraBaseQuaternion.copy(camera.quaternion)
        camera.getWorldDirection(state.cameraForward).normalize()
        state.cameraRight.crossVectors(state.cameraForward, UP_VECTOR).normalize()
        state.cameraUp.crossVectors(state.cameraRight, state.cameraForward).normalize()

        if (document.pointerLockElement) {
          document.exitPointerLock()
        }

        pointerLockBlockHandler = (event) => {
          if (event.target !== renderer.domElement) {
            return
          }

          event.preventDefault()
          event.stopPropagation()
          if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation()
          }

          if (document.pointerLockElement) {
            document.exitPointerLock()
          }
        }
        renderer.domElement.addEventListener('click', pointerLockBlockHandler, true)

        movementKeyBlockHandler = (event) => {
          if (!MOVEMENT_KEY_CODES.has(event.code)) {
            return
          }

          event.preventDefault()
          event.stopPropagation()
          if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation()
          }
        }
        window.addEventListener('keydown', movementKeyBlockHandler, true)
      },

      update({ delta, camera }) {
        if (!sceneGroup || !saturnSystem || !stars || !dockedEndurance) {
          return
        }

        state.flybyProgress = (state.flybyProgress + delta / state.flybyDuration) % 1

        camera.position.copy(state.cameraBasePosition)
        camera.quaternion.copy(state.cameraBaseQuaternion)

        const flybyT = state.flybyProgress * 2 - 1
        const lateralOffset = flybyT * metersToWorld(1700)
        const verticalOffset = metersToWorld(-120)
        const forwardOffset = metersToWorld(1000)

        dockedEndurance.position.copy(state.cameraBasePosition)
        dockedEndurance.position.addScaledVector(state.cameraForward, forwardOffset)
        dockedEndurance.position.addScaledVector(state.cameraRight, lateralOffset)
        dockedEndurance.position.addScaledVector(state.cameraUp, verticalOffset)

        dockedEndurance.rotation.z += delta * state.shipSpinRate
        dockedEndurance.rotation.y += delta * state.shipSpinRate * 0.25

        stars.position.copy(camera.position)
      },

      resize() {},

      dispose({ camera, renderer, scene }) {
        if (pointerLockBlockHandler && renderer?.domElement) {
          renderer.domElement.removeEventListener('click', pointerLockBlockHandler, true)
          pointerLockBlockHandler = null
        }

        if (movementKeyBlockHandler) {
          window.removeEventListener('keydown', movementKeyBlockHandler, true)
          movementKeyBlockHandler = null
        }

        camera.near = savedCameraNear
        camera.far = savedCameraFar
        camera.fov = savedCameraFov
        camera.updateProjectionMatrix()

        scene.background = savedBackground ? savedBackground.clone() : null

        if (!sceneGroup) {
          return
        }

        if (rootRef && sceneGroup.parent !== rootRef) {
          rootRef.add(sceneGroup)
        }

        disposeObject3D(sceneGroup)
        sceneGroup = null
        stars = null
        saturnSystem = null
        dockedEndurance = null
        sunLight = null
        fillLight = null
        rootRef = null
      },
    }
  },
}
