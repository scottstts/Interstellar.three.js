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
  hash,
  length,
  Loop,
  max,
  mix,
  min,
  mx_noise_float,
  normalize,
  normalWorld,
  positionLocal,
  positionWorld,
  pow,
  smoothstep,
  sqrt,
  step,
  texture,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { disposeObject3D } from '../utils/dispose'

const EARTH_RADIUS = 24000
const EARTH_SHELL_RADIUS = EARTH_RADIUS * (1 + 110 / 6371)
const EARTH_ATMOSPHERE_HEIGHT = EARTH_SHELL_RADIUS - EARTH_RADIUS
const MAX_ASCENT_ALTITUDE = EARTH_ATMOSPHERE_HEIGHT * 1.05
const COAST_ASCENT_RATE = EARTH_ATMOSPHERE_HEIGHT * 0.05
const MAX_ORBITAL_DRIFT = EARTH_ATMOSPHERE_HEIGHT * 0.42
const MAX_ARC_OFFSET = EARTH_ATMOSPHERE_HEIGHT * 0.08
const ENDURANCE_X_OFFSET = 140
const ENDURANCE_ALTITUDE_OFFSET = 260
const ENDURANCE_Z_OFFSET = -1450
const ATMOSPHERE_POST_PATH_FADE_NEAR_WORLD = 0.35
const ATMOSPHERE_POST_STRENGTH = 0.14
const ATMOSPHERE_SHELL_FACE_TRANSITION_MIN_KM = 32
const DEFAULT_AIRLIGHT = new THREE.Color(0x7fa8d4)
const ATMOSPHERE_SUN_DIRECTION = new THREE.Vector3(0.83, 0.34, -0.45).normalize()
const IGNITION_HOLD_SECONDS = 1.2
const ASCENT_SECONDS = 24
const STAGE_ONE_SEPARATION_SECONDS = 13.2
const END_SEQUENCE_LAUNCH_TIME = ASCENT_SECONDS + 3.4
const LAUNCH_SURFACE_Y = 8
const ATMOSPHERE_VIEW_SAMPLES = 18
const ATMOSPHERE_LIGHT_SAMPLES = 10
const ATMOSPHERE_VISUAL_THICKNESS_BOOST = 1.7

const SKY_COLOR = new THREE.Color(0x7ea7d2)
const SPACE_COLOR = new THREE.Color(0x02040a)
const TMP_VEC3_A = new THREE.Vector3()
const TMP_VEC3_B = new THREE.Vector3()
const TMP_VEC3_C = new THREE.Vector3()
const TMP_VEC3_D = new THREE.Vector3()
const TMP_VEC3_E = new THREE.Vector3()
const TMP_QUAT_A = new THREE.Quaternion()
const EULER_A = new THREE.Euler()
const TMP_AP_DIR = new THREE.Vector3()
const TMP_AP_OC = new THREE.Vector3()
const TMP_AP_SEG_START = new THREE.Vector3()
const TMP_AP_SEG_END = new THREE.Vector3()
const TMP_AP_SUN = new THREE.Vector3()
const TMP_AP_COLOR = new THREE.Color()
const TMP_AP_COLOR_2 = new THREE.Color()
const TMP_AP_AIRLIGHT = new THREE.Color()
const TMP_AP_TRANS_RGB = new THREE.Vector3(1, 1, 1)
const TMP_ENDURANCE_WORLD = new THREE.Vector3()
const MOVEMENT_KEY_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
  'ShiftLeft',
  'ShiftRight',
])

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

function randomSpread(amount) {
  return (Math.random() * 2 - 1) * amount
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

function computeAtmosphereAerialPerspective({
  atmosphereCenter,
  bodyRadius,
  cameraPosition,
  model,
  sunDirection,
  targetPosition,
  topRadius,
}) {
  TMP_AP_DIR.copy(targetPosition).sub(cameraPosition)
  const rawRayLength = TMP_AP_DIR.length()
  if (rawRayLength < 1e-5) {
    return {
      airlight: DEFAULT_AIRLIGHT,
      effectWeight: 0,
      transLuma: 1,
      transmittance: TMP_AP_TRANS_RGB.set(1, 1, 1),
    }
  }
  TMP_AP_DIR.multiplyScalar(1 / rawRayLength)

  TMP_AP_OC.copy(cameraPosition).sub(atmosphereCenter)
  const bTop = TMP_AP_OC.dot(TMP_AP_DIR)
  const cTop = TMP_AP_OC.lengthSq() - topRadius * topRadius
  const hTop = bTop * bTop - cTop
  if (hTop <= 0) {
    return {
      airlight: DEFAULT_AIRLIGHT,
      effectWeight: 0,
      transLuma: 1,
      transmittance: TMP_AP_TRANS_RGB.set(1, 1, 1),
    }
  }

  const topSqrt = Math.sqrt(Math.max(hTop, 0))
  const tTopEnter = -bTop - topSqrt
  const tTopExit = -bTop + topSqrt
  const segmentStart = Math.max(tTopEnter, 0)
  const segmentEnd = Math.min(rawRayLength, tTopExit)
  const rayLength = Math.max(segmentEnd - segmentStart, 0)
  if (rayLength <= 1e-5) {
    return {
      airlight: DEFAULT_AIRLIGHT,
      effectWeight: 0,
      transLuma: 1,
      transmittance: TMP_AP_TRANS_RGB.set(1, 1, 1),
    }
  }

  TMP_AP_SEG_START.copy(cameraPosition).addScaledVector(TMP_AP_DIR, segmentStart).sub(atmosphereCenter)
  TMP_AP_SEG_END.copy(cameraPosition).addScaledVector(TMP_AP_DIR, segmentEnd).sub(atmosphereCenter)

  const startRadius = TMP_AP_SEG_START.length()
  const endRadius = TMP_AP_SEG_END.length()
  const cameraHeight = Math.max(startRadius - bodyRadius, 0)
  const targetHeight = Math.max(endRadius - bodyRadius, 0)

  const atmosphereThickness = Math.max(topRadius - bodyRadius, 1e-5)
  const pathFade = smoothstepRange(ATMOSPHERE_POST_PATH_FADE_NEAR_WORLD, atmosphereThickness * 0.72, rayLength)
  const effectiveRayleighHeight = Math.max(model.rayleighScaleHeightWorld, atmosphereThickness * 0.16)
  const effectiveMieHeight = Math.max(model.mieScaleHeightWorld, atmosphereThickness * 0.08)

  const densityR0 = Math.exp(-cameraHeight / effectiveRayleighHeight)
  const densityR1 = Math.exp(-targetHeight / effectiveRayleighHeight)
  const densityM0 = Math.exp(-cameraHeight / effectiveMieHeight)
  const densityM1 = Math.exp(-targetHeight / effectiveMieHeight)

  const opticalDepthR = (densityR0 + densityR1) * rayLength * 0.5
  const opticalDepthM = (densityM0 + densityM1) * rayLength * 0.5

  const tauR = new THREE.Vector3(
    model.rayleighScatteringWorld[0] * opticalDepthR,
    model.rayleighScatteringWorld[1] * opticalDepthR,
    model.rayleighScatteringWorld[2] * opticalDepthR,
  )
  const tauM = new THREE.Vector3(
    model.mieExtinctionWorld[0] * opticalDepthM,
    model.mieExtinctionWorld[1] * opticalDepthM,
    model.mieExtinctionWorld[2] * opticalDepthM,
  )

  TMP_AP_TRANS_RGB.set(
    Math.exp(-(tauR.x + tauM.x) * ATMOSPHERE_POST_STRENGTH),
    Math.exp(-(tauR.y + tauM.y) * ATMOSPHERE_POST_STRENGTH),
    Math.exp(-(tauR.z + tauM.z) * ATMOSPHERE_POST_STRENGTH),
  )

  TMP_AP_SUN.copy(sunDirection).normalize()
  const mu = THREE.MathUtils.clamp(TMP_AP_DIR.dot(TMP_AP_SUN), -1, 1)
  const phaseRayleigh = 0.05968310365946075 * (1 + mu * mu)
  const g = model.miePhaseG
  const g2 = g * g
  const phaseMie =
    (0.07957747154594767 * (1 - g2)) /
    Math.pow(1 + g2 - 2 * g * mu, 1.5)

  const inScatteringR = new THREE.Vector3(
    model.rayleighScatteringWorld[0] * opticalDepthR * phaseRayleigh,
    model.rayleighScatteringWorld[1] * opticalDepthR * phaseRayleigh,
    model.rayleighScatteringWorld[2] * opticalDepthR * phaseRayleigh,
  )
  const inScatteringM = new THREE.Vector3(
    model.mieScatteringWorld[0] * opticalDepthM * phaseMie,
    model.mieScatteringWorld[1] * opticalDepthM * phaseMie,
    model.mieScatteringWorld[2] * opticalDepthM * phaseMie,
  )
  const scatterGain = model.solarIntensity * ATMOSPHERE_POST_STRENGTH * 0.34
  TMP_AP_AIRLIGHT.setRGB(
    (inScatteringR.x + inScatteringM.x) * scatterGain,
    (inScatteringR.y + inScatteringM.y) * scatterGain,
    (inScatteringR.z + inScatteringM.z) * scatterGain,
  )
  TMP_AP_AIRLIGHT.setRGB(
    TMP_AP_AIRLIGHT.r / (TMP_AP_AIRLIGHT.r * 0.24 + 1),
    TMP_AP_AIRLIGHT.g / (TMP_AP_AIRLIGHT.g * 0.24 + 1),
    TMP_AP_AIRLIGHT.b / (TMP_AP_AIRLIGHT.b * 0.24 + 1),
  )

  const transLuma = THREE.MathUtils.clamp(
    TMP_AP_TRANS_RGB.x * 0.2126 + TMP_AP_TRANS_RGB.y * 0.7152 + TMP_AP_TRANS_RGB.z * 0.0722,
    0,
    1,
  )

  return {
    airlight: TMP_AP_AIRLIGHT,
    effectWeight: THREE.MathUtils.clamp(pathFade, 0, 1),
    transLuma,
    transmittance: TMP_AP_TRANS_RGB,
  }
}

function createEarthSystem(earthTexture) {
  const group = new THREE.Group()
  group.name = 'scene05-earth-system'

  const worldNormal = normalWorld.normalize()
  const viewDirection = normalize(cameraPosition.sub(positionWorld))

  const earthMaterial = new THREE.MeshBasicNodeMaterial()
  earthMaterial.colorNode = texture(earthTexture)

  const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 144, 96), earthMaterial)
  earth.name = 'scene05-earth'
  earth.receiveShadow = true
  earth.castShadow = false
  group.add(earth)

  const cloudMaterial = new THREE.MeshStandardNodeMaterial({
    transparent: true,
    depthWrite: false,
    roughness: 0.94,
    metalness: 0,
  })
  const cloudCoord = worldNormal
    .mul(18.0)
    .add(vec3(time.mul(0.016), time.mul(-0.011), time.mul(0.007)))
  const cloudNoise = mx_noise_float(cloudCoord)
  const cloudFine = mx_noise_float(cloudCoord.mul(2.5).add(vec3(-3.6, 5.2, 7.1)))
  const cloudMask = smoothstep(0.56, 0.88, cloudNoise.mul(0.7).add(cloudFine.mul(0.3)))
  const cloudFresnel = float(1.0).sub(abs(dot(worldNormal, viewDirection))).pow(3.1)

  cloudMaterial.colorNode = mix(color(0x90abc8), color(0xffffff), cloudMask)
  cloudMaterial.opacityNode = cloudMask.mul(0.2).add(cloudFresnel.mul(0.1)).clamp(0.0, 0.28)

  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * 1.008, 120, 72),
    cloudMaterial,
  )
  clouds.name = 'scene05-earth-clouds'
  clouds.castShadow = false
  clouds.receiveShadow = false
  clouds.visible = false
  group.add(clouds)

  const atmosphereCenter = new THREE.Vector3(0, -EARTH_RADIUS + LAUNCH_SURFACE_Y, 0)
  const atmosphereModel = createStellarAtmosphereModel(
    {
      atmosphereDensity: 1.0,
      atmosphereHeightKm: 110,
      kind: 'terrestrial',
      radiusKm: 6371,
    },
    EARTH_RADIUS / 6371,
  )
  const atmosphereShellOpacity = uniform(0.24)
  const atmosphereFrontFaceOpacity = uniform(0.94)
  const atmosphereBackFaceOpacity = uniform(0.0)
  const atmosphereMaterial = createStellarAtmosphereMaterial(
    uniform(ATMOSPHERE_SUN_DIRECTION.clone()),
    uniform(atmosphereCenter.clone()),
    uniform(EARTH_RADIUS),
    uniform(EARTH_SHELL_RADIUS),
    atmosphereShellOpacity,
    atmosphereFrontFaceOpacity,
    atmosphereBackFaceOpacity,
    atmosphereModel,
  )
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_SHELL_RADIUS, 128, 80),
    atmosphereMaterial,
  )
  atmosphere.name = 'scene05-earth-atmosphere'
  group.add(atmosphere)

  group.position.copy(atmosphereCenter)

  return {
    atmosphereCenter,
    atmosphereModel,
    atmosphere,
    atmosphereBackFaceOpacity,
    clouds,
    earth,
    group,
    atmosphereFrontFaceOpacity,
    atmosphereShellOpacity,
    sunDirection: ATMOSPHERE_SUN_DIRECTION.clone(),
  }
}

function createLaunchFacility() {
  const group = new THREE.Group()
  group.name = 'scene05-nasa-launch-facility'

  const concrete = new THREE.MeshStandardMaterial({
    color: 0x5f646d,
    metalness: 0.08,
    roughness: 0.92,
  })
  const steel = new THREE.MeshStandardMaterial({
    color: 0xb8bec8,
    metalness: 0.72,
    roughness: 0.36,
  })
  const darkSteel = new THREE.MeshStandardMaterial({
    color: 0x373d46,
    metalness: 0.66,
    roughness: 0.44,
  })

  const pad = new THREE.Mesh(new THREE.CylinderGeometry(102, 118, 14, 72), concrete)
  pad.position.y = 1
  pad.receiveShadow = true
  group.add(pad)

  const blastTrench = new THREE.Mesh(new THREE.CylinderGeometry(24, 28, 28, 40), darkSteel)
  blastTrench.position.y = -10
  group.add(blastTrench)

  const siloWall = new THREE.Mesh(new THREE.CylinderGeometry(30, 34, 126, 64, 1, true), steel)
  siloWall.position.y = 63
  group.add(siloWall)

  const outerWall = new THREE.Mesh(new THREE.CylinderGeometry(41, 45, 132, 64, 1, true), darkSteel)
  outerWall.position.y = 66
  outerWall.material = outerWall.material.clone()
  outerWall.material.opacity = 0.92
  outerWall.material.transparent = true
  group.add(outerWall)

  const topRing = new THREE.Mesh(new THREE.TorusGeometry(36, 1.8, 18, 64), darkSteel)
  topRing.position.y = 127
  topRing.rotation.x = Math.PI / 2
  group.add(topRing)

  const lowerRing = new THREE.Mesh(new THREE.TorusGeometry(34, 1.3, 14, 48), steel)
  lowerRing.position.y = 20
  lowerRing.rotation.x = Math.PI / 2
  group.add(lowerRing)

  for (let i = 0; i < 18; i += 1) {
    const angle = (i / 18) * Math.PI * 2
    const radius = 36.2
    const strut = new THREE.Mesh(new THREE.BoxGeometry(1.2, 124, 2.4), steel)
    strut.position.set(Math.cos(angle) * radius, 63, Math.sin(angle) * radius)
    strut.castShadow = true
    group.add(strut)
  }

  const serviceArms = []
  for (let level = 0; level < 3; level += 1) {
    const armHeight = 48 + level * 24
    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 3) * Math.PI * 2 + level * 0.17
      const pivot = new THREE.Group()
      pivot.position.set(Math.cos(angle) * 31, armHeight, Math.sin(angle) * 31)
      pivot.rotation.y = angle + Math.PI

      const arm = new THREE.Mesh(new THREE.BoxGeometry(20, 1.4, 2.2), steel)
      arm.position.z = 10
      arm.castShadow = true
      pivot.add(arm)

      const head = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.4, 3.4), darkSteel)
      head.position.z = 20.5
      pivot.add(head)

      pivot.userData.retractAngle = -0.78 - level * 0.08
      serviceArms.push(pivot)
      group.add(pivot)
    }
  }

  return { group, serviceArms }
}

function createEnginePlumeLayer({
  boostOuterColor,
  boostTint = 0.4,
  flickerScale = 8.5,
  flickerSpeed = 3.2,
  height,
  innerColor,
  intensityGain = 2.2,
  outerColor,
  radiusBottom,
  radiusTop,
}) {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 28, 1, true)
  geometry.translate(0, -height * 0.5, 0)

  const throttle = uniform(0)
  const boost = uniform(0)

  const plumeV = positionLocal.y.negate().div(height).clamp(0, 1)
  const core = float(1).sub(plumeV).pow(2.25)
  const edge = smoothstep(float(radiusBottom * 0.96), float(Math.max(radiusTop * 0.18, radiusBottom * 0.14)), positionLocal.xz.length())
  const flicker = hash(positionLocal.mul(flickerScale).add(time.mul(flickerSpeed))).mul(0.34).add(0.66)
  const flowNoise = mx_noise_float(
    positionLocal
      .mul(0.26)
      .add(vec3(time.mul(1.5), time.mul(-1.0), time.mul(1.25))),
  )
  const structure = smoothstep(0.2, 0.92, flowNoise).mul(0.44).add(0.56)
  const intensity = core.mul(edge).mul(flicker).mul(structure).mul(throttle).mul(intensityGain)
  const boostGain = mix(float(1.0), float(1.54), boost)

  const hotInner = mix(color(innerColor), color(boostOuterColor), boost.mul(boostTint))
  const hotOuter = mix(color(outerColor), color(boostOuterColor), boost)
  const plumeColor = mix(hotInner, hotOuter, plumeV).mul(intensity).mul(boostGain)

  const material = new THREE.MeshBasicNodeMaterial()
  material.colorNode = plumeColor
  material.opacityNode = intensity
  material.transparent = true
  material.depthWrite = false
  material.blending = THREE.AdditiveBlending

  const mesh = new THREE.Mesh(geometry, material)
  mesh.visible = false

  return {
    mesh,
    setPower: (value, isBoost = false) => {
      const clamped = clamp01(value)
      throttle.value = clamped
      boost.value = isBoost ? 1 : 0
      mesh.visible = clamped > 0.003
      mesh.scale.set(
        1 + clamped * 0.1,
        0.85 + clamped * 0.65,
        1 + clamped * 0.1,
      )
    },
  }
}

function createRocket() {
  const group = new THREE.Group()
  group.name = 'scene05-launch-rocket'

  const bodyWhite = new THREE.MeshStandardMaterial({
    color: 0xf1f4f8,
    metalness: 0.26,
    roughness: 0.43,
  })
  const panelDark = new THREE.MeshStandardMaterial({
    color: 0x2f3541,
    metalness: 0.44,
    roughness: 0.38,
  })
  const alloy = new THREE.MeshStandardMaterial({
    color: 0x9ca3af,
    metalness: 0.74,
    roughness: 0.28,
  })

  const stageOne = new THREE.Group()
  stageOne.name = 'scene05-stage-one'
  group.add(stageOne)

  const stageOneCore = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.8, 62, 32), bodyWhite)
  stageOneCore.position.y = 31
  stageOneCore.castShadow = true
  stageOne.add(stageOneCore)

  const stageOneBand = new THREE.Mesh(new THREE.CylinderGeometry(4.35, 4.6, 4.8, 32), panelDark)
  stageOneBand.position.y = 17
  stageOne.add(stageOneBand)

  const stageOneBase = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 5.2, 8, 28), alloy)
  stageOneBase.position.y = 4
  stageOne.add(stageOneBase)

  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2
    const booster = new THREE.Mesh(new THREE.CylinderGeometry(1.28, 1.44, 44, 16), bodyWhite)
    booster.position.set(Math.cos(angle) * 7.1, 24, Math.sin(angle) * 7.1)
    booster.castShadow = true
    stageOne.add(booster)
  }

  const upperStage = new THREE.Group()
  upperStage.name = 'scene05-upper-stage'
  upperStage.position.y = 62
  group.add(upperStage)

  const stageTwoBody = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.4, 31, 28), bodyWhite)
  stageTwoBody.position.y = 15.5
  stageTwoBody.castShadow = true
  upperStage.add(stageTwoBody)

  const stageTwoBand = new THREE.Mesh(new THREE.CylinderGeometry(3.15, 3.15, 3.2, 24), panelDark)
  stageTwoBand.position.y = 8
  upperStage.add(stageTwoBand)

  const stageTwoAdapter = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 3.0, 6.2, 24), alloy)
  stageTwoAdapter.position.y = 34
  upperStage.add(stageTwoAdapter)

  const rangerSection = new THREE.Mesh(new THREE.CapsuleGeometry(2.05, 5.2, 10, 18), bodyWhite)
  rangerSection.position.y = 40.5
  rangerSection.castShadow = true
  upperStage.add(rangerSection)

  const noseCone = new THREE.Mesh(new THREE.ConeGeometry(2.5, 12.5, 24), bodyWhite)
  noseCone.position.y = 49.2
  upperStage.add(noseCone)

  const stageOneNozzles = []
  const nozzleGeometry = new THREE.CylinderGeometry(1.35, 2.1, 4.8, 20)
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 4) * Math.PI * 2
    const isCenter = i === 4
    const x = isCenter ? 0 : Math.cos(angle) * 2.5
    const z = isCenter ? 0 : Math.sin(angle) * 2.5
    const nozzle = new THREE.Mesh(nozzleGeometry, alloy)
    nozzle.position.set(x, 0.8, z)
    stageOne.add(nozzle)
    stageOneNozzles.push(new THREE.Vector3(x, -1.4, z))
  }

  const stageTwoNozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.5, 3.8, 18), alloy)
  stageTwoNozzle.position.y = -0.25
  upperStage.add(stageTwoNozzle)
  const stageTwoNozzles = [new THREE.Vector3(0, 60.25, 0)]

  const stageOnePlumeGroup = new THREE.Group()
  stageOnePlumeGroup.position.y = -0.8
  stageOne.add(stageOnePlumeGroup)

  const stageOneOuterPlume = createEnginePlumeLayer({
    boostOuterColor: 0x7fd9ff,
    boostTint: 0.35,
    flickerScale: 9.8,
    flickerSpeed: 3.7,
    height: 52,
    innerColor: 0xfff3ca,
    intensityGain: 2.3,
    outerColor: 0xff9443,
    radiusBottom: 6.6,
    radiusTop: 2.5,
  })
  const stageOneCorePlume = createEnginePlumeLayer({
    boostOuterColor: 0xa9e8ff,
    boostTint: 0.25,
    flickerScale: 11.4,
    flickerSpeed: 4.5,
    height: 37,
    innerColor: 0xffffff,
    intensityGain: 2.85,
    outerColor: 0xffcd74,
    radiusBottom: 3.15,
    radiusTop: 0.9,
  })

  stageOnePlumeGroup.add(stageOneOuterPlume.mesh, stageOneCorePlume.mesh)

  const stageOnePlumeHalo = new THREE.Mesh(
    new THREE.SphereGeometry(3.6, 20, 14),
    new THREE.MeshBasicMaterial({
      color: 0xffd89a,
      transparent: true,
      opacity: 0.56,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  stageOnePlumeHalo.scale.set(1.2, 0.66, 1.2)
  stageOnePlumeHalo.position.y = -2.2
  stageOnePlumeGroup.add(stageOnePlumeHalo)

  const stageTwoPlumeGroup = new THREE.Group()
  stageTwoPlumeGroup.position.y = -1.4
  stageTwoPlumeGroup.visible = false
  upperStage.add(stageTwoPlumeGroup)

  const stageTwoOuterPlume = createEnginePlumeLayer({
    boostOuterColor: 0x84dcff,
    flickerScale: 10.3,
    flickerSpeed: 3.9,
    height: 20,
    innerColor: 0xfff7d4,
    intensityGain: 2.4,
    outerColor: 0xffab56,
    radiusBottom: 2.65,
    radiusTop: 0.82,
  })
  const stageTwoCorePlume = createEnginePlumeLayer({
    boostOuterColor: 0xb5eeff,
    boostTint: 0.2,
    flickerScale: 12.2,
    flickerSpeed: 4.7,
    height: 13.5,
    innerColor: 0xffffff,
    intensityGain: 3.0,
    outerColor: 0xffd793,
    radiusBottom: 1.25,
    radiusTop: 0.4,
  })
  stageTwoPlumeGroup.add(stageTwoOuterPlume.mesh, stageTwoCorePlume.mesh)

  const stageTwoPlumeHalo = new THREE.Mesh(
    new THREE.SphereGeometry(1.7, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xffe6be,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  stageTwoPlumeHalo.scale.set(1.16, 0.54, 1.16)
  stageTwoPlumeHalo.position.y = -0.95
  stageTwoPlumeGroup.add(stageTwoPlumeHalo)

  function setStageOnePlume(power, isBoost = false) {
    const clamped = clamp01(power)
    stageOneOuterPlume.setPower(clamped, isBoost)
    stageOneCorePlume.setPower(clamped, isBoost)
    stageOnePlumeGroup.visible = clamped > 0.003
    stageOnePlumeHalo.visible = stageOnePlumeGroup.visible
    stageOnePlumeHalo.material.opacity = THREE.MathUtils.lerp(0.2, 0.6, clamped)
    stageOnePlumeHalo.scale.setScalar(THREE.MathUtils.lerp(0.72, 1.34, clamped))
    stageOnePlumeHalo.scale.y *= 0.56
  }

  function setStageTwoPlume(power, isBoost = false) {
    const clamped = clamp01(power)
    stageTwoOuterPlume.setPower(clamped, isBoost)
    stageTwoCorePlume.setPower(clamped, isBoost)
    stageTwoPlumeGroup.visible = clamped > 0.003
    stageTwoPlumeHalo.visible = stageTwoPlumeGroup.visible
    stageTwoPlumeHalo.material.opacity = THREE.MathUtils.lerp(0.22, 0.64, clamped)
    stageTwoPlumeHalo.scale.setScalar(THREE.MathUtils.lerp(0.76, 1.26, clamped))
    stageTwoPlumeHalo.scale.y *= 0.54
  }

  return {
    group,
    stageOne,
    stageOneNozzles,
    setStageOnePlume,
    setStageTwoPlume,
    stageTwoNozzles,
    upperStage,
  }
}

function createEndurance() {
  const group = new THREE.Group()
  group.name = 'scene05-endurance'

  const hullWhite = new THREE.MeshStandardMaterial({
    color: 0xdfe5ec,
    metalness: 0.68,
    roughness: 0.34,
  })
  const hullDark = new THREE.MeshStandardMaterial({
    color: 0x4f5967,
    metalness: 0.54,
    roughness: 0.42,
  })
  const blackPanel = new THREE.MeshStandardMaterial({
    color: 0x1e2430,
    metalness: 0.3,
    roughness: 0.56,
  })
  const materials = [hullWhite, hullDark, blackPanel]
  const baseColors = materials.map((material) => material.color.clone())

  for (const material of materials) {
    material.transparent = true
    material.opacity = 1
  }

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 3.8, 18, 24), hullDark)
  hub.rotation.z = Math.PI / 2
  group.add(hub)

  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 36, 16), hullWhite)
  spindle.rotation.x = Math.PI / 2
  group.add(spindle)

  const ringRadius = 27
  const moduleCount = 12
  for (let i = 0; i < moduleCount; i += 1) {
    const angle = (i / moduleCount) * Math.PI * 2
    const modulePivot = new THREE.Group()
    modulePivot.position.set(Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, 0)
    modulePivot.rotation.z = angle + Math.PI / 2

    const frame = new THREE.Mesh(new THREE.BoxGeometry(13, 7.2, 3.2), hullWhite)
    frame.castShadow = true
    modulePivot.add(frame)

    const panel = new THREE.Mesh(new THREE.BoxGeometry(10.5, 4.2, 1.1), blackPanel)
    panel.position.z = 2.05
    modulePivot.add(panel)

    const rear = new THREE.Mesh(new THREE.BoxGeometry(4.4, 5.4, 2.2), hullDark)
    rear.position.x = -5.2
    modulePivot.add(rear)

    group.add(modulePivot)

    const truss = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, ringRadius - 4.8, 8), hullDark)
    truss.position.set(Math.cos(angle) * (ringRadius * 0.5), Math.sin(angle) * (ringRadius * 0.5), 0)
    truss.rotation.z = angle + Math.PI / 2
    group.add(truss)
  }

  const dockingRing = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.7, 12, 32), hullWhite)
  dockingRing.position.set(0, 0, -9.5)
  dockingRing.rotation.x = Math.PI / 2
  group.add(dockingRing)

  group.scale.setScalar(2.1)
  return {
    baseColors,
    group,
    materials,
  }
}

function createSpaceStars() {
  const starCount = 2400
  const data = new Float32Array(starCount * 3)

  for (let i = 0; i < starCount; i += 1) {
    const index = i * 3
    const radius = EARTH_RADIUS * (2.2 + Math.random() * 1.3)
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)

    data[index] = Math.sin(phi) * Math.cos(theta) * radius
    data[index + 1] = Math.cos(phi) * radius
    data[index + 2] = Math.sin(phi) * Math.sin(theta) * radius
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data, 3))

  const material = new THREE.PointsMaterial({
    color: 0xd9e8ff,
    size: 9,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })

  const stars = new THREE.Points(geometry, material)
  stars.name = 'scene05-space-stars'
  return stars
}

function createExhaustSystem(particleCount = 340) {
  const positions = new Float32Array(particleCount * 3)
  const colors = new Float32Array(particleCount * 3)
  const life = new Float32Array(particleCount)
  const maxLife = new Float32Array(particleCount)
  const velocities = Array.from({ length: particleCount }, () => new THREE.Vector3())

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const material = new THREE.PointsMaterial({
    size: 12,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.74,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  })

  const points = new THREE.Points(geometry, material)
  points.name = 'scene05-exhaust-particles'
  points.frustumCulled = false

  const hidden = new THREE.Vector3(1e7, 1e7, 1e7)
  function hideParticle(index) {
    const base = index * 3
    positions[base] = hidden.x
    positions[base + 1] = hidden.y
    positions[base + 2] = hidden.z
    colors[base] = 0
    colors[base + 1] = 0
    colors[base + 2] = 0
    life[index] = 0
    maxLife[index] = 0
  }

  for (let i = 0; i < particleCount; i += 1) {
    hideParticle(i)
  }

  const tmpJitter = new THREE.Vector3()

  function spawn(index, emitters, direction, shipVelocity, thrust, atmosphereDensity) {
    if (emitters.length === 0) {
      hideParticle(index)
      return
    }

    const emitter = emitters[Math.floor(Math.random() * emitters.length)]
    const base = index * 3
    const radial = 0.35 + Math.random() * 1.2
    const angle = Math.random() * Math.PI * 2

    positions[base] = emitter.x + Math.cos(angle) * radial
    positions[base + 1] = emitter.y + randomSpread(0.65)
    positions[base + 2] = emitter.z + Math.sin(angle) * radial

    tmpJitter.set(randomSpread(0.48), randomSpread(0.24), randomSpread(0.48))
    velocities[index]
      .copy(direction)
      .add(tmpJitter)
      .normalize()
      .multiplyScalar(THREE.MathUtils.lerp(98, 175, thrust) * (0.58 + Math.random() * 0.8))
      .addScaledVector(shipVelocity, 0.24)

    maxLife[index] = THREE.MathUtils.lerp(0.36, 1.38, atmosphereDensity) * (0.65 + Math.random() * 0.75)
    life[index] = maxLife[index]
  }

  function update(delta, emitters, direction, shipVelocity, thrust, atmosphereDensity) {
    const safeDelta = Math.min(delta, 0.05)
    if (safeDelta <= 0) {
      return
    }

    for (let i = 0; i < particleCount; i += 1) {
      life[i] -= safeDelta
      const base = i * 3

      if (life[i] <= 0) {
        if (thrust > 0.03 && Math.random() < thrust * 1.35) {
          spawn(i, emitters, direction, shipVelocity, thrust, atmosphereDensity)
        } else {
          hideParticle(i)
        }
        continue
      }

      positions[base] += velocities[i].x * safeDelta
      positions[base + 1] += velocities[i].y * safeDelta
      positions[base + 2] += velocities[i].z * safeDelta

      const drag = Math.max(0, 1 - safeDelta * THREE.MathUtils.lerp(2.2, 1.05, atmosphereDensity))
      velocities[i].multiplyScalar(drag)
      velocities[i].y -= safeDelta * THREE.MathUtils.lerp(34, 9, 1 - atmosphereDensity)

      const life01 = life[i] / Math.max(maxLife[i], 1e-6)
      const age = 1 - life01
      const flame = Math.pow(life01, 1.2)
      const smoke = smoothstepRange(0.18, 1, age)

      colors[base] = THREE.MathUtils.lerp(1.0, 0.46, smoke)
      colors[base + 1] = THREE.MathUtils.lerp(0.72, 0.42, smoke)
      colors[base + 2] = THREE.MathUtils.lerp(0.22, 0.5, smoke * atmosphereDensity) + flame * 0.12
    }

    const spawnBudget = Math.floor(particleCount * safeDelta * THREE.MathUtils.lerp(3.5, 9.5, thrust))
    for (let i = 0; i < spawnBudget; i += 1) {
      const index = (Math.random() * particleCount) | 0
      if (life[index] <= 0) {
        spawn(index, emitters, direction, shipVelocity, thrust, atmosphereDensity)
      }
    }

    material.opacity = THREE.MathUtils.lerp(0.28, 0.82, thrust)
    material.size = THREE.MathUtils.lerp(7.5, 14.5, atmosphereDensity)
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.color.needsUpdate = true
  }

  function clear() {
    for (let i = 0; i < particleCount; i += 1) {
      hideParticle(i)
    }
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.color.needsUpdate = true
  }

  return {
    clear,
    points,
    update,
  }
}

export default {
  id: 'endurance-launch',
  title: 'Endurance Launch from Earth',
  create() {
    let rootRef = null
    let sceneGroup = null
    let earth = null
    let launchFacility = null
    let rocket = null
    let endurance = null
    let stars = null
    let exhaust = null
    let sunLight = null
    let ambientLight = null
    let rimLight = null
    let engineLight = null

    let savedCameraNear = 0
    let savedCameraFar = 0
    let savedCameraFov = 0
    let savedBackground = null
    let movementKeyBlockHandler = null
    let mouseOrbitHandler = null
    const sceneBackground = new THREE.Color()

    const state = {
      elapsed: 0,
      orbitPitch: 0,
      orbitYaw: 0,
      previousRocketPosition: new THREE.Vector3(),
      rocketVelocity: new THREE.Vector3(),
      sequenceComplete: false,
      stageOneDetached: false,
      detachedStageVelocity: new THREE.Vector3(),
      detachedStageAngularVelocity: new THREE.Vector3(),
      separationShock: 0,
      detachedTimer: 0,
    }

    function setRocketTransform(sequenceTime) {
      const launchTime = Math.max(sequenceTime - IGNITION_HOLD_SECONDS, 0)
      const ascentProgress = clamp01(launchTime / ASCENT_SECONDS)
      const coastTime = Math.max(launchTime - ASCENT_SECONDS, 0)
      const easedRise = Math.pow(ascentProgress, 1.62)
      const altitude = easedRise * MAX_ASCENT_ALTITUDE + coastTime * COAST_ASCENT_RATE

      // Hold a true vertical rise for the first segment, then gradually start the gravity turn.
      const lateralBlend = smoothstepRange(0.46, 0.9, ascentProgress)
      const orbitalDrift = -Math.pow(ascentProgress, 1.35) * MAX_ORBITAL_DRIFT * lateralBlend
        - coastTime * (MAX_ORBITAL_DRIFT * 0.025)
      const arcOffset = Math.sin(ascentProgress * Math.PI * 0.78) * MAX_ARC_OFFSET * lateralBlend
        + coastTime * (MAX_ARC_OFFSET * 0.01)

      const pitchAmount =
        -THREE.MathUtils.lerp(0, 0.46, smoothstepRange(0.52, 0.94, ascentProgress)) - Math.min(coastTime * 0.01, 0.06)
      const yawAmount =
        THREE.MathUtils.lerp(0, 0.08, smoothstepRange(0.58, 0.92, ascentProgress))
        + Math.min(coastTime * 0.0035, 0.03)

      const shakeEnvelope = 1 - smoothstepRange(0.05, 0.9, ascentProgress)
      const vibration = (Math.sin(sequenceTime * 52) + Math.sin(sequenceTime * 31 + 0.7)) * 0.0024 * shakeEnvelope
      const rollAmount = Math.sin(sequenceTime * 2.5) * 0.008 * shakeEnvelope + vibration

      rocket.group.position.set(arcOffset, LAUNCH_SURFACE_Y + altitude, orbitalDrift)
      EULER_A.set(pitchAmount, yawAmount, rollAmount, 'YXZ')
      rocket.group.quaternion.setFromEuler(EULER_A)
      rocket.group.updateMatrixWorld(true)

      return {
        ascentProgress,
        altitude,
        launchTime,
      }
    }

    function detachStageOne() {
      if (state.stageOneDetached) {
        return
      }

      state.stageOneDetached = true
      state.detachedTimer = 0
      state.separationShock = 1.15

      rocket.stageOne.getWorldPosition(TMP_VEC3_A)
      rocket.stageOne.getWorldQuaternion(TMP_QUAT_A)

      rocket.group.remove(rocket.stageOne)
      sceneGroup.add(rocket.stageOne)

      rocket.stageOne.position.copy(TMP_VEC3_A)
      rocket.stageOne.quaternion.copy(TMP_QUAT_A)

      TMP_VEC3_B.set(0, 1, 0).applyQuaternion(rocket.group.quaternion).normalize()
      state.detachedStageVelocity
        .copy(state.rocketVelocity)
        .addScaledVector(TMP_VEC3_B, -96)
        .add(new THREE.Vector3(randomSpread(12), -64, randomSpread(16)))

      state.detachedStageAngularVelocity.set(
        randomSpread(0.7),
        randomSpread(0.45),
        randomSpread(0.88),
      )

      rocket.setStageOnePlume(0)
      rocket.setStageTwoPlume(0.15)
    }

    function updateDetachedStage(delta) {
      if (!state.stageOneDetached) {
        return
      }

      state.detachedTimer += delta
      state.detachedStageVelocity.y -= delta * 34
      state.detachedStageVelocity.z += delta * 5.5
      state.detachedStageVelocity.multiplyScalar(Math.max(0, 1 - delta * 0.12))

      rocket.stageOne.position.addScaledVector(state.detachedStageVelocity, delta)
      rocket.stageOne.rotation.x += state.detachedStageAngularVelocity.x * delta
      rocket.stageOne.rotation.y += state.detachedStageAngularVelocity.y * delta
      rocket.stageOne.rotation.z += state.detachedStageAngularVelocity.z * delta

      if (state.detachedTimer > 12) {
        rocket.stageOne.visible = false
      }
    }

    function collectEngineEmitters() {
      const nozzles = state.stageOneDetached ? rocket.stageTwoNozzles : rocket.stageOneNozzles
      const emitters = []
      for (let i = 0; i < nozzles.length; i += 1) {
        TMP_VEC3_A.copy(nozzles[i]).applyMatrix4(rocket.group.matrixWorld)
        emitters.push(TMP_VEC3_A.clone())
      }
      return emitters
    }

    function updateCamera(camera, delta, sequenceTime, ascentProgress) {
      rocket.upperStage.getWorldPosition(TMP_VEC3_A)
      TMP_VEC3_B.set(0, 1, 0).applyQuaternion(rocket.group.quaternion).normalize()

      const orbitBlend = smoothstepRange(0.08, 0.94, ascentProgress)
      const followDistance = THREE.MathUtils.lerp(22, 236, orbitBlend)
      const baseAzimuth = THREE.MathUtils.lerp(0.22, 0.88, orbitBlend)
      const basePitch = THREE.MathUtils.lerp(0.12, 0.28, orbitBlend)
      const azimuth = baseAzimuth + state.orbitYaw
      const pitch = THREE.MathUtils.clamp(basePitch + state.orbitPitch, -0.72, 1.08)

      TMP_VEC3_C
        .set(
          Math.sin(azimuth) * Math.cos(pitch) * followDistance,
          Math.sin(pitch) * followDistance,
          Math.cos(azimuth) * Math.cos(pitch) * followDistance,
        )
        .applyQuaternion(rocket.group.quaternion)
      TMP_VEC3_D.copy(TMP_VEC3_A).add(TMP_VEC3_C)

      const shakeBase = (1 - smoothstepRange(0.12, 0.9, ascentProgress)) * 1.45 + state.separationShock * 0.9
      TMP_VEC3_E.set(randomSpread(shakeBase), randomSpread(shakeBase * 0.6), randomSpread(shakeBase))
      TMP_VEC3_D.add(TMP_VEC3_E)

      camera.position.lerp(TMP_VEC3_D, 1 - Math.exp(-delta * 6.4))
      TMP_VEC3_E.copy(TMP_VEC3_A).addScaledVector(TMP_VEC3_B, 12)
      camera.lookAt(TMP_VEC3_E)

      const targetFov = THREE.MathUtils.lerp(43, 57, smoothstepRange(0.18, 0.78, ascentProgress))
      if (Math.abs(camera.fov - targetFov) > 0.02) {
        camera.fov = targetFov
        camera.updateProjectionMatrix()
      }

      if (sequenceTime < IGNITION_HOLD_SECONDS + 0.2) {
        camera.position.y += Math.sin(sequenceTime * 88) * 0.08
      }
    }

    function updateEarthAtmosphereShell(camera) {
      if (!earth || !earth.atmosphereShellOpacity || !earth.atmosphereFrontFaceOpacity || !earth.atmosphereBackFaceOpacity) {
        return
      }

      const cameraDistance = camera.position.distanceTo(earth.atmosphereCenter)
      const altitudeFromTop = cameraDistance - EARTH_SHELL_RADIUS
      const kmToWorld = EARTH_RADIUS / 6371
      const faceBlendBand = Math.max(
        ATMOSPHERE_SHELL_FACE_TRANSITION_MIN_KM * kmToWorld,
        EARTH_ATMOSPHERE_HEIGHT * 0.18,
      )
      const insideBlend = 1 - THREE.MathUtils.smoothstep(altitudeFromTop, -faceBlendBand, faceBlendBand)

      earth.atmosphereFrontFaceOpacity.value = THREE.MathUtils.clamp(1 - insideBlend, 0, 1)
      earth.atmosphereBackFaceOpacity.value = THREE.MathUtils.clamp(insideBlend, 0, 1)

      const shellOuterFade = THREE.MathUtils.smoothstep(
        altitudeFromTop,
        EARTH_ATMOSPHERE_HEIGHT * 0.12,
        EARTH_ATMOSPHERE_HEIGHT * 1.6,
      )
      earth.atmosphereShellOpacity.value = THREE.MathUtils.lerp(0.28, 0.12, shellOuterFade)
    }

    function updateEnduranceAtmosphereFade(camera) {
      if (!earth || !endurance || !endurance.materials || !endurance.baseColors) {
        return
      }

      endurance.group.getWorldPosition(TMP_ENDURANCE_WORLD)
      const aerial = computeAtmosphereAerialPerspective({
        atmosphereCenter: earth.atmosphereCenter,
        bodyRadius: EARTH_RADIUS,
        cameraPosition: camera.position,
        model: earth.atmosphereModel,
        sunDirection: earth.sunDirection,
        targetPosition: TMP_ENDURANCE_WORLD,
        topRadius: EARTH_SHELL_RADIUS,
      })

      const trans = aerial.transmittance
      for (let i = 0; i < endurance.materials.length; i += 1) {
        const material = endurance.materials[i]
        const baseColor = endurance.baseColors[i]

        TMP_AP_COLOR.setRGB(
          baseColor.r * trans.x + aerial.airlight.r * (1 - trans.x),
          baseColor.g * trans.y + aerial.airlight.g * (1 - trans.y),
          baseColor.b * trans.z + aerial.airlight.b * (1 - trans.z),
        )
        TMP_AP_COLOR_2.copy(baseColor).lerp(TMP_AP_COLOR, aerial.effectWeight)
        material.color.copy(TMP_AP_COLOR_2)

        const visibility = THREE.MathUtils.clamp(
          1 - aerial.effectWeight * (1 - aerial.transLuma) * 1.2,
          0.03,
          1,
        )
        material.opacity = visibility
      }
    }

    return {
      async init({ root, camera, renderer, scene }) {
        rootRef = root

        sceneGroup = new THREE.Group()
        sceneGroup.name = 'scene05-root'
        root.add(sceneGroup)

        savedCameraNear = camera.near
        savedCameraFar = camera.far
        savedCameraFov = camera.fov
        camera.near = 0.2
        camera.far = 180000
        camera.fov = 45
        camera.updateProjectionMatrix()

        if (scene.background && scene.background.isColor) {
          savedBackground = scene.background.clone()
        } else {
          savedBackground = null
        }
        scene.background = SKY_COLOR.clone()

        ambientLight = new THREE.HemisphereLight(0xd5e7ff, 0x2f2619, 1.15)
        sunLight = new THREE.DirectionalLight(0xfff0d8, 1.9)
        rimLight = new THREE.DirectionalLight(0x7ba7ff, 0.7)
        engineLight = new THREE.PointLight(0xff9e47, 0, 340, 1.9)

        sunLight.position.set(760, 1140, 580)
        rimLight.position.set(-980, 340, -920)
        sceneGroup.add(ambientLight, sunLight, rimLight, engineLight)

        const textureLoader = new THREE.TextureLoader()
        const earthTexture = await textureLoader.loadAsync('/textures/earth_texture.jpg')
        earthTexture.colorSpace = THREE.SRGBColorSpace
        earthTexture.wrapS = THREE.RepeatWrapping
        earthTexture.wrapT = THREE.ClampToEdgeWrapping
        earthTexture.generateMipmaps = true
        if (renderer?.capabilities && typeof renderer.capabilities.getMaxAnisotropy === 'function') {
          earthTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
        }
        earthTexture.needsUpdate = true

        earth = createEarthSystem(earthTexture)
        launchFacility = createLaunchFacility()
        rocket = createRocket()
        endurance = createEndurance()
        stars = createSpaceStars()
        exhaust = createExhaustSystem()

        sceneGroup.add(earth.group)
        sceneGroup.add(launchFacility.group)
        sceneGroup.add(rocket.group)
        sceneGroup.add(exhaust.points)
        sceneGroup.add(endurance.group)
        sceneGroup.add(stars)

        rocket.group.position.set(0, LAUNCH_SURFACE_Y, 0)
        rocket.group.updateMatrixWorld(true)
        state.previousRocketPosition.copy(rocket.group.position)
        rocket.setStageOnePlume(0)
        rocket.setStageTwoPlume(0)

        endurance.group.position.set(
          ENDURANCE_X_OFFSET,
          LAUNCH_SURFACE_Y + MAX_ASCENT_ALTITUDE + ENDURANCE_ALTITUDE_OFFSET,
          ENDURANCE_Z_OFFSET,
        )
        endurance.group.rotation.set(0.46, -0.12, 0.9)

        camera.position.set(10.5, 68, 18.5)
        camera.lookAt(0, LAUNCH_SURFACE_Y + 66, 0)

        movementKeyBlockHandler = (event) => {
          if (!MOVEMENT_KEY_CODES.has(event.code)) {
            return
          }

          if (document.pointerLockElement) {
            event.preventDefault()
            event.stopPropagation()
            if (typeof event.stopImmediatePropagation === 'function') {
              event.stopImmediatePropagation()
            }
          }
        }
        window.addEventListener('keydown', movementKeyBlockHandler, true)

        mouseOrbitHandler = (event) => {
          if (!document.pointerLockElement) {
            return
          }

          state.orbitYaw -= event.movementX * 0.0022
          state.orbitPitch = THREE.MathUtils.clamp(
            state.orbitPitch + event.movementY * 0.0018,
            -0.85,
            0.95,
          )
        }
        window.addEventListener('mousemove', mouseOrbitHandler, true)
      },

      update({ delta, camera, scene }) {
        if (!sceneGroup || !rocket || !earth || !launchFacility || !endurance || !stars || !exhaust) {
          return
        }

        const safeDelta = Math.min(delta, 0.05)
        if (!state.sequenceComplete) {
          state.elapsed += safeDelta
        }
        const sequenceTime = state.elapsed

        let trajectory = setRocketTransform(sequenceTime)
        let ascentProgress = trajectory.ascentProgress
        let altitude = trajectory.altitude

        if (!state.sequenceComplete && trajectory.launchTime >= END_SEQUENCE_LAUNCH_TIME) {
          state.sequenceComplete = true
          state.elapsed = IGNITION_HOLD_SECONDS + END_SEQUENCE_LAUNCH_TIME
          trajectory = setRocketTransform(state.elapsed)
          ascentProgress = trajectory.ascentProgress
          altitude = trajectory.altitude
          state.separationShock = 0
          exhaust.clear()
          exhaust.points.visible = false
          rocket.setStageOnePlume(0)
          rocket.setStageTwoPlume(0)
        }

        if (state.sequenceComplete) {
          state.rocketVelocity.set(0, 0, 0)
        } else {
          state.rocketVelocity
            .copy(rocket.group.position)
            .sub(state.previousRocketPosition)
            .multiplyScalar(1 / Math.max(safeDelta, 1e-4))
        }
        state.previousRocketPosition.copy(rocket.group.position)

        const ignitionBlend = smoothstepRange(IGNITION_HOLD_SECONDS - 0.5, IGNITION_HOLD_SECONDS + 0.45, sequenceTime)
        if (!state.stageOneDetached && trajectory.launchTime >= STAGE_ONE_SEPARATION_SECONDS) {
          detachStageOne()
        }

        if (!state.sequenceComplete) {
          updateDetachedStage(safeDelta)
        }
        state.separationShock = Math.max(0, state.separationShock - safeDelta * 1.85)

        updateEarthAtmosphereShell(camera)

        const stageTwoBlend = smoothstepRange(STAGE_ONE_SEPARATION_SECONDS, STAGE_ONE_SEPARATION_SECONDS + 2.5, trajectory.launchTime)
        const activeThrust = state.stageOneDetached ? THREE.MathUtils.lerp(0.52, 0.86, stageTwoBlend) : ignitionBlend
        const thrust = state.sequenceComplete ? 0 : activeThrust

        if (state.sequenceComplete) {
          rocket.setStageOnePlume(0)
          rocket.setStageTwoPlume(0)
        } else if (state.stageOneDetached) {
          const stageTwoPulse = 0.9 + Math.sin(sequenceTime * 28.0) * 0.1
          rocket.setStageOnePlume(0)
          rocket.setStageTwoPlume(thrust * stageTwoPulse, true)
        } else {
          const stageOnePulse = 0.9 + Math.sin(sequenceTime * 36.0) * 0.1
          rocket.setStageOnePlume(thrust * stageOnePulse, false)
          rocket.setStageTwoPlume(0)
        }

        const emitters = collectEngineEmitters()
        TMP_VEC3_A.set(0, -1, 0).applyQuaternion(rocket.group.quaternion).normalize()
        const atmosphereDensity = 1 - smoothstepRange(0.34, 0.84, ascentProgress)
        if (state.sequenceComplete) {
          exhaust.points.visible = false
        } else {
          exhaust.points.visible = true
          exhaust.update(
            safeDelta,
            emitters,
            TMP_VEC3_A,
            state.rocketVelocity,
            thrust,
            atmosphereDensity,
          )
        }

        launchFacility.group.visible = ascentProgress < 0.58
        const armRetract = smoothstepRange(IGNITION_HOLD_SECONDS - 0.32, IGNITION_HOLD_SECONDS + 1.15, sequenceTime)
        for (let i = 0; i < launchFacility.serviceArms.length; i += 1) {
          const arm = launchFacility.serviceArms[i]
          const retractAngle = arm.userData.retractAngle ?? -0.8
          arm.rotation.x = retractAngle * armRetract
        }

        const spaceBlend = smoothstepRange(
          EARTH_ATMOSPHERE_HEIGHT * 0.18,
          EARTH_ATMOSPHERE_HEIGHT * 0.62,
          altitude,
        )
        sceneBackground.copy(SKY_COLOR).lerp(SPACE_COLOR, spaceBlend)
        scene.background = sceneBackground

        ambientLight.intensity = THREE.MathUtils.lerp(1.15, 0.34, spaceBlend)
        sunLight.intensity = THREE.MathUtils.lerp(1.85, 2.35, spaceBlend)
        rimLight.intensity = THREE.MathUtils.lerp(0.7, 1.16, spaceBlend)

        engineLight.intensity = state.sequenceComplete ? 0 : THREE.MathUtils.lerp(0, 9.4, thrust)
        TMP_VEC3_B.copy(emitters[0] ?? rocket.group.position).add(TMP_VEC3_A.clone().multiplyScalar(8))
        engineLight.position.copy(TMP_VEC3_B)

        if (!state.sequenceComplete) {
          earth.earth.rotation.y += safeDelta * 0.012
          earth.clouds.rotation.y += safeDelta * 0.018
          earth.atmosphere.rotation.y += safeDelta * 0.004
        }

        if (!state.sequenceComplete) {
          endurance.group.rotation.z += safeDelta * 0.11
          endurance.group.rotation.x = 0.42 + Math.sin(sequenceTime * 0.08) * 0.02
        }
        updateEnduranceAtmosphereFade(camera)

        stars.position.copy(camera.position)
        stars.material.opacity = THREE.MathUtils.lerp(
          0,
          0.86,
          smoothstepRange(
            EARTH_ATMOSPHERE_HEIGHT * 0.28,
            EARTH_ATMOSPHERE_HEIGHT * 0.78,
            altitude,
          ),
        )

        updateCamera(camera, safeDelta, sequenceTime, ascentProgress)
      },

      resize() {},

      dispose({ camera, scene }) {
        if (camera) {
          camera.near = savedCameraNear || camera.near
          camera.far = savedCameraFar || camera.far
          camera.fov = savedCameraFov || camera.fov
          camera.updateProjectionMatrix()
        }

        if (movementKeyBlockHandler) {
          window.removeEventListener('keydown', movementKeyBlockHandler, true)
          movementKeyBlockHandler = null
        }

        if (mouseOrbitHandler) {
          window.removeEventListener('mousemove', mouseOrbitHandler, true)
          mouseOrbitHandler = null
        }

        if (scene) {
          scene.background = savedBackground ?? new THREE.Color(0x02040a)
        }

        if (sceneGroup) {
          if (rootRef && sceneGroup.parent !== rootRef) {
            rootRef.add(sceneGroup)
          }

          disposeObject3D(sceneGroup)
        }

        rootRef = null
        sceneGroup = null
        earth = null
        launchFacility = null
        rocket = null
        endurance = null
        stars = null
        exhaust = null
        sunLight = null
        ambientLight = null
        rimLight = null
        engineLight = null
        savedBackground = null
      },
    }
  },
}
