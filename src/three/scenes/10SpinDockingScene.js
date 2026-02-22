import * as THREE from 'three/webgpu'
import {
  abs,
  cameraPosition,
  clamp,
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
  mx_fractal_noise_float,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  smoothstep,
  sqrt,
  step,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { disposeObject3D } from '../utils/dispose'

const WORLD_UNITS_PER_KM = 1

const MANN_PLANET_RADIUS_KM = 6120
const MANN_ATMOSPHERE_HEIGHT_KM = 160
const MANN_PLANET_RADIUS = MANN_PLANET_RADIUS_KM * WORLD_UNITS_PER_KM
const MANN_SHELL_RADIUS = (MANN_PLANET_RADIUS_KM + MANN_ATMOSPHERE_HEIGHT_KM) * WORLD_UNITS_PER_KM

const SPACE_COLOR = new THREE.Color(0x02040a)
const STAR_COLOR = new THREE.Color(0xffffff)
const SUN_DIRECTION = new THREE.Vector3(0.88, 0.2, 0.43).normalize()

const CAMERA_FOV = 46
const CAMERA_NEAR = 10
const CAMERA_FAR = 260000
const CAMERA_ORBIT_ALTITUDE_KM = 940

const ATMOSPHERE_VIEW_SAMPLES = 18
const ATMOSPHERE_LIGHT_SAMPLES = 10
const ATMOSPHERE_VISUAL_THICKNESS_BOOST = 1.7

const TMP_VEC3_A = new THREE.Vector3()

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
  stars.name = 'scene10-space-stars'
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

function createIcyPlanetSurfaceMaterial() {
  const material = new THREE.MeshStandardNodeMaterial()

  const remap01 = (value) => value.mul(0.5).add(0.5)
  const p = positionLocal.normalize()

  const nContinent = remap01(mx_fractal_noise_float(p.mul(1.8), 4, 2.0, 0.5))
  const nSheet = remap01(mx_fractal_noise_float(p.mul(5.5), 5, 2.1, 0.48))
  const nFrost = remap01(mx_fractal_noise_float(p.mul(14.0), 4, 2.0, 0.45))
  const nCrack = remap01(mx_fractal_noise_float(p.mul(22.0), 3, 2.3, 0.5))
  const nCrack2 = remap01(mx_fractal_noise_float(p.mul(40.0), 2, 2.0, 0.5))

  const lat = abs(p.y)
  const polarCap = smoothstep(0.35, 0.75, lat)

  const iceMask = clamp(
    smoothstep(0.38, 0.62, nContinent).add(polarCap.mul(0.5)),
    float(0),
    float(1),
  )

  const crackDist = abs(nCrack.sub(0.5)).mul(2.0)
  const crackDist2 = abs(nCrack2.sub(0.5)).mul(2.0)
  const crackLine1 = smoothstep(0.0, 0.12, crackDist)
  const crackLine2 = smoothstep(0.0, 0.06, crackDist2)

  const crackZone = iceMask.mul(polarCap.oneMinus().add(0.3).clamp(0, 1))
  const finalCrack = mix(float(1.0), crackLine1, crackZone.mul(0.9))
    .mul(mix(float(1.0), crackLine2, crackZone.mul(0.6)))

  const colOcean = vec3(0.01, 0.06, 0.14)
  const colDeepIce = vec3(0.08, 0.21, 0.42)
  const colIce = vec3(0.48, 0.76, 0.92)
  const colSnow = vec3(0.88, 0.95, 1.0)
  const colPolarSnow = vec3(0.96, 0.985, 1.0)
  const colCrack = vec3(0.82, 0.9, 0.97)
  const colCrackGlow = vec3(0.9, 0.96, 1.0)

  let surfaceColor = colOcean.toVar()
  surfaceColor = mix(surfaceColor, mix(colDeepIce, colIce, nSheet), iceMask)

  const frostFactor = smoothstep(0.52, 0.78, nFrost).mul(iceMask)
  surfaceColor = mix(surfaceColor, colSnow, frostFactor)
  surfaceColor = mix(surfaceColor, colPolarSnow, polarCap.mul(0.85))

  const crackInterior = mix(colCrack, colCrackGlow, smoothstep(0.0, 0.08, crackDist))
  surfaceColor = mix(crackInterior, surfaceColor, finalCrack)

  const roughBase = mix(float(0.85), float(0.08), iceMask)
  const roughCrack = finalCrack.oneMinus().mul(0.55)
  const roughSnow = frostFactor.mul(0.35)
  const roughness = clamp(roughBase.add(roughCrack).add(roughSnow), float(0.04), float(0.95))
  const metalness = mix(float(0.0), float(0.05), iceMask.mul(finalCrack))

  material.colorNode = surfaceColor
  material.roughnessNode = roughness
  material.metalnessNode = metalness

  return material
}

function createMannsPlanetSystem() {
  const group = new THREE.Group()
  group.name = 'scene10-manns-planet-system'

  const planetMaterial = createIcyPlanetSurfaceMaterial()

  const planet = new THREE.Mesh(new THREE.SphereGeometry(MANN_PLANET_RADIUS, 168, 112), planetMaterial)
  planet.name = 'scene10-manns-planet'
  planet.receiveShadow = true
  group.add(planet)

  const atmosphereModel = createStellarAtmosphereModel(
    {
      atmosphereDensity: 0.92,
      atmosphereHeightKm: MANN_ATMOSPHERE_HEIGHT_KM,
      kind: 'rocky',
      radiusKm: MANN_PLANET_RADIUS_KM,
    },
    WORLD_UNITS_PER_KM,
  )
  const atmosphereShellOpacity = uniform(1)
  const atmosphereFrontFaceOpacity = uniform(1)
  const atmosphereBackFaceOpacity = uniform(0.0)
  const atmosphereCenterWorld = uniform(new THREE.Vector3(0, 0, 0))

  const atmosphereMaterial = createStellarAtmosphereMaterial(
    uniform(SUN_DIRECTION.clone()),
    atmosphereCenterWorld,
    uniform(MANN_PLANET_RADIUS),
    uniform(MANN_SHELL_RADIUS),
    atmosphereShellOpacity,
    atmosphereFrontFaceOpacity,
    atmosphereBackFaceOpacity,
    atmosphereModel,
  )

  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(MANN_SHELL_RADIUS, 128, 88), atmosphereMaterial)
  atmosphere.name = 'scene10-manns-planet-atmosphere'
  atmosphere.renderOrder = 10
  group.add(atmosphere)

  group.rotation.x = THREE.MathUtils.degToRad(23.5)
  group.rotation.z = THREE.MathUtils.degToRad(-9.5)

  return {
    atmosphere,
    atmosphereCenterWorld,
    group,
    planet,
  }
}

export default {
  id: 'endurance-spin-docking',
  title: 'Endurance Spin-Docking Maneuver',
  create() {
    let rootRef = null
    let sceneGroup = null
    let stars = null
    let planetSystem = null
    let sunLight = null
    let fillLight = null

    let savedCameraNear = 0
    let savedCameraFar = 0
    let savedCameraFov = 0
    let savedBackground = null

    function positionCamera(camera) {
      const cameraDistance = MANN_PLANET_RADIUS + CAMERA_ORBIT_ALTITUDE_KM
      camera.position.set(cameraDistance, 220, 640)
      camera.lookAt(-MANN_PLANET_RADIUS * 0.54, MANN_PLANET_RADIUS * 0.06, -MANN_PLANET_RADIUS * 0.32)
    }

    function updateAtmosphereCenterUniform() {
      if (!planetSystem) {
        return
      }

      planetSystem.group.getWorldPosition(TMP_VEC3_A)
      planetSystem.atmosphereCenterWorld.value.copy(TMP_VEC3_A)
    }

    return {
      init({ camera, root, scene }) {
        rootRef = root
        sceneGroup = new THREE.Group()
        sceneGroup.name = 'scene10-group'
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

        fillLight = new THREE.AmbientLight(0x1a2130, 0.2)
        sunLight = new THREE.DirectionalLight(0xfff2de, 2.6)
        sunLight.position.copy(SUN_DIRECTION).multiplyScalar(200000)
        sceneGroup.add(fillLight, sunLight, sunLight.target)

        planetSystem = createMannsPlanetSystem()
        sceneGroup.add(planetSystem.group)
        updateAtmosphereCenterUniform()

        stars = createSpaceStars()
        sceneGroup.add(stars)

        positionCamera(camera)
      },

      update({ camera }) {
        if (!planetSystem || !stars) {
          return
        }

        updateAtmosphereCenterUniform()

        stars.position.copy(camera.position)
      },

      resize() {},

      dispose({ camera, scene }) {
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
        planetSystem = null
        sunLight = null
        fillLight = null
        rootRef = null
      },
    }
  },
}
