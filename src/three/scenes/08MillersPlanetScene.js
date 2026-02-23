import * as THREE from 'three/webgpu'
import {
  Fn,
  uniform,
  vec2,
  vec3,
  float,
  sin,
  cos,
  exp,
  dot,
  normalize,
  reflect,
  length,
  mix,
  clamp,
  pow,
  smoothstep,
  varying,
  positionLocal,
  positionWorld,
  cameraPosition,
  color,
  texture,
  normalLocal,
  uv,
  step,
  fract,
  max,
} from 'three/tsl'
import { disposeObject3D } from '../utils/dispose'

const WAVE_GEOMETRY_WIDTH_SEGMENTS = 200
const WAVE_GEOMETRY_HEIGHT_SEGMENTS = 100
const OCEAN_WAVES = [
  [0.94, 0.32, 0.38, 28.0, 0.5],
  [-0.42, 0.91, 0.24, 18.0, 0.46],
  [0.78, -0.52, 0.16, 12.0, 0.42],
  [-0.35, -0.78, 0.1, 10.0, 0.35],
  [0.55, 0.62, 0.06, 9.5, 0.28],
]
const CAMERA_WATER_CLEARANCE = 0.38

function createOceanShaderSet() {
  const timeU = uniform(0.0)
  const sunDir = uniform(new THREE.Vector3(-0.28, 0.62, -0.73).normalize())

  const skyColor = Fn(([dir]) => {
    const y = dir.y

    const belowC = vec3(0.52, 0.68, 0.88)
    const horizC = vec3(0.76, 0.87, 0.99)
    const lowerC = vec3(0.5, 0.72, 0.95)
    const midC = vec3(0.19, 0.44, 0.83)
    const zenithC = vec3(0.04, 0.13, 0.52)

    const t0 = smoothstep(float(-0.1), float(0.0), y)
    const t1 = smoothstep(float(0.0), float(0.28), y)
    const t2 = smoothstep(float(0.28), float(0.85), y)

    const grad = mix(mix(belowC, horizC, t0), mix(lowerC, mix(midC, zenithC, t2), t1), t1)

    const sd = clamp(dot(dir, sunDir), float(0), float(1))
    const disk = pow(sd, float(5000.0)).mul(50.0)
    const halo = pow(sd, float(20.0)).mul(2.8)
    const glare = pow(sd, float(4.0)).mul(0.5)

    return grad
      .add(vec3(1.0, 0.95, 0.75).mul(disk))
      .add(vec3(1.0, 0.72, 0.32).mul(halo))
      .add(vec3(1.0, 0.8, 0.5).mul(glare))
  })

  const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide })
  skyMaterial.colorNode = skyColor(normalize(positionLocal.xyz))
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMaterial)
  skyMesh.name = 'miller-ocean-sky-dome'

  const wavePosition = Fn(([px, pz]) => {
    let dx = float(0)
    let dy = float(0)
    let dz = float(0)

    for (const [dX, dZ, amp, len, steep] of OCEAN_WAVES) {
      const k = 2 * Math.PI / len
      const omega = Math.sqrt(9.81 * k)
      const qa = steep * amp

      const phase = float(k)
        .mul(float(dX).mul(px).add(float(dZ).mul(pz)))
        .sub(float(omega).mul(timeU))

      dx = dx.add(float(dX * qa).mul(cos(phase)))
      dy = dy.add(float(amp).mul(sin(phase)))
      dz = dz.add(float(dZ * qa).mul(cos(phase)))
    }

    return vec3(px.add(dx), dy, pz.add(dz))
  })

  const waveNormal = Fn(([px, pz]) => {
    let nx = float(0)
    let ny = float(0)
    let nz = float(0)

    for (const [dX, dZ, amp, len, steep] of OCEAN_WAVES) {
      const k = 2 * Math.PI / len
      const omega = Math.sqrt(9.81 * k)
      const kA = k * amp

      const phase = float(k)
        .mul(float(dX).mul(px).add(float(dZ).mul(pz)))
        .sub(float(omega).mul(timeU))

      nx = nx.add(float(dX * kA).mul(sin(phase)))
      ny = ny.add(float(steep * kA).mul(cos(phase)))
      nz = nz.add(float(dZ * kA).mul(sin(phase)))
    }

    return normalize(vec3(nx.negate(), float(1.0).sub(ny), nz.negate()))
  })

  const waveNormV = varying(waveNormal(positionLocal.x, positionLocal.z))

  const waterColor = Fn(() => {
    const P = positionWorld.xyz
    const N0 = normalize(waveNormV)
    const t = timeU

    const tau = float(Math.PI * 2.0)

    const uv1 = P.xz.mul(0.44).add(vec2(t.mul(0.023), t.mul(0.016)))
    const uv2 = P.xz.mul(0.8).add(vec2(t.mul(-0.016), t.mul(0.03)))
    const uv3 = P.xz.mul(1.55).add(vec2(t.mul(0.011), t.mul(-0.021)))
    const uv4 = P.xz.mul(2.8).add(vec2(t.mul(-0.008), t.mul(0.014)))

    const rN1 = vec3(sin(uv1.x.mul(tau)).mul(0.06), float(1), cos(uv1.y.mul(tau)).mul(0.06))
    const rN2 = vec3(sin(uv2.x.mul(tau)).mul(0.04), float(1), cos(uv2.y.mul(tau)).mul(0.04))
    const rN3 = vec3(sin(uv3.x.mul(tau)).mul(0.022), float(1), cos(uv3.y.mul(tau)).mul(0.022))
    const rN4 = vec3(sin(uv4.x.mul(tau)).mul(0.01), float(1), cos(uv4.y.mul(tau)).mul(0.01))

    const N = normalize(N0.add(rN1.mul(float(0.32))).add(rN2.mul(float(0.22))).add(rN3.mul(float(0.13))).add(rN4.mul(float(0.07))))

    const V = normalize(cameraPosition.sub(P))
    const NdV = clamp(dot(N, V), float(0.001), float(1.0))

    const F0 = float(0.02)
    const F = F0.add(float(1.0).sub(F0).mul(pow(float(1.0).sub(NdV), float(5.0))))

    const R = reflect(V.negate(), N)
    const reflSky = skyColor(R)

    const rSd = clamp(dot(R, sunDir), float(0), float(1))
    const rDisk = pow(rSd, float(2500.0)).mul(22.0)
    const rHalo = pow(rSd, float(14.0)).mul(1.5)
    const reflSun = vec3(1.0, 0.95, 0.72).mul(rDisk).add(vec3(1.0, 0.7, 0.36).mul(rHalo))
    const reflCol = reflSky.add(reflSun)

    const deepC = vec3(0.005, 0.042, 0.115)
    const shallowC = vec3(0.022, 0.15, 0.268)
    const bodyC = mix(deepC, shallowC, float(1.0).sub(F).mul(0.3))

    const sssI = pow(clamp(dot(V, sunDir.negate()), float(0), float(1)), float(4.0))
    const sssC = vec3(0.0, 0.27, 0.19).mul(sssI.mul(0.42)).mul(float(1.0).sub(F))

    const crest = pow(clamp(float(1.0).sub(N.y).mul(5.0), float(0), float(1)), float(2.0))
    const foamC = vec3(0.9, 0.95, 1.0).mul(crest.mul(0.28))

    const H = normalize(V.add(sunDir))
    const NdH = clamp(dot(N, H), float(0), float(1))
    const spec = pow(NdH, float(1200.0)).mul(22.0)
    const specC = vec3(1.0, 0.96, 0.8).mul(spec)

    const surface = mix(bodyC.add(sssC), reflCol, F).add(specC).add(foamC)

    const dist = length(P.sub(cameraPosition))
    const fogAmt = clamp(float(1.0).sub(exp(dist.negate().mul(0.0026))), float(0), float(1))
    const fogC = vec3(0.76, 0.87, 0.99)

    return mix(surface, fogC, fogAmt)
  })

  const oceanGeometry = new THREE.PlaneGeometry(1200, 1200, 256, 256)
  oceanGeometry.rotateX(-Math.PI / 2)

  const oceanMaterial = new THREE.MeshBasicNodeMaterial()
  oceanMaterial.positionNode = wavePosition(positionLocal.x, positionLocal.z)
  oceanMaterial.colorNode = waterColor()

  const oceanMesh = new THREE.Mesh(oceanGeometry, oceanMaterial)
  oceanMesh.name = 'miller-ocean-surface'

  return { oceanMesh, skyMesh, timeU }
}

function getOceanSurfaceHeightAt(x, z, timeSeconds) {
  let height = 0

  for (const [dirX, dirZ, amplitude, wavelength] of OCEAN_WAVES) {
    const k = (2 * Math.PI) / wavelength
    const omega = Math.sqrt(9.81 * k)
    const phase = k * (dirX * x + dirZ * z) - omega * timeSeconds
    height += amplitude * Math.sin(phase)
  }

  return height
}

function createAstronaut() {
  const astronaut = new THREE.Group()
  astronaut.name = 'miller-astronaut'

  const suitMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xf2f2ee,
    roughness: 0.78,
    metalness: 0.08,
    sheen: 0.22,
    sheenColor: 0xcdd5df,
  })

  const trimMaterial = new THREE.MeshStandardMaterial({
    color: 0x6f7988,
    roughness: 0.58,
    metalness: 0.26,
  })

  const visorMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x161b24,
    roughness: 0.1,
    metalness: 0.9,
    clearcoat: 1.0,
    clearcoatRoughness: 0.12,
  })

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.28, 0.62), suitMaterial)
  body.position.y = 2.42
  astronaut.add(body)

  const chestUnit = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.12), trimMaterial)
  chestUnit.position.set(0, 2.23, 0.37)
  astronaut.add(chestUnit)

  const head = new THREE.Group()
  head.position.set(0, 3.52, 0)
  head.rotation.y = Math.PI
  astronaut.add(head)

  const helmetBase = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.86, 0.8), suitMaterial)
  head.add(helmetBase)

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.44, 0.1), visorMaterial)
  visor.position.set(0, 0.03, 0.45)
  head.add(visor)

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.82, 0.24), trimMaterial)
  backpack.position.set(0, 2.41, -0.42)
  astronaut.add(backpack)

  const leftArm = new THREE.Group()
  const leftArmUpper = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.56, 0.26), suitMaterial)
  leftArmUpper.position.y = -0.16
  leftArm.add(leftArmUpper)
  const leftForearm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.5, 0.24), suitMaterial)
  leftForearm.position.y = -0.72
  leftArm.add(leftForearm)
  leftArm.position.set(-0.66, 2.58, 0.02)
  astronaut.add(leftArm)

  const rightArm = leftArm.clone(true)
  rightArm.position.x = 0.66
  astronaut.add(rightArm)

  const leftLeg = new THREE.Group()
  const leftThigh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.72, 0.34), suitMaterial)
  leftThigh.position.y = -0.2
  leftLeg.add(leftThigh)
  const leftCalf = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.68, 0.31), suitMaterial)
  leftCalf.position.y = -0.9
  leftLeg.add(leftCalf)
  const leftBoot = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.65), trimMaterial)
  leftBoot.position.set(0, -1.34, -0.12)
  leftLeg.add(leftBoot)
  leftLeg.position.set(-0.24, 1.74, 0)
  astronaut.add(leftLeg)

  const rightLeg = leftLeg.clone(true)
  rightLeg.position.x = 0.24
  astronaut.add(rightLeg)

  const shoulderLeft = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), trimMaterial)
  shoulderLeft.position.set(-0.66, 2.92, 0)
  astronaut.add(shoulderLeft)

  const shoulderRight = shoulderLeft.clone()
  shoulderRight.position.x = 0.66
  astronaut.add(shoulderRight)

  astronaut.userData.pose = {
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    neutralY: astronaut.position.y,
  }

  return astronaut
}

function createTarsDecalTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 4096
  const context = canvas.getContext('2d')

  if (!context) {
    const fallback = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat)
    fallback.colorSpace = THREE.SRGBColorSpace
    fallback.needsUpdate = true
    return fallback
  }

  context.clearRect(0, 0, canvas.width, canvas.height)

  const width = canvas.width
  const height = canvas.height

  context.fillStyle = '#050505'
  context.fillRect(width * 0.1, height * 0.28, width * 0.8, height * 0.08)
  context.fillRect(width * 0.1, height * 0.72, width * 0.38, height * 0.12)
  context.fillRect(width * 0.52, height * 0.72, width * 0.38, height * 0.12)

  context.fillStyle = '#a55a30'
  context.textAlign = 'center'
  context.textBaseline = 'middle'

  context.font = 'bold 40px sans-serif'
  context.fillText('MARINE CORPS', width * 0.5, height * 0.43)

  context.font = 'bold 240px sans-serif'
  context.scale(1, 1.2)
  context.fillText('CASE', width * 0.5, (height * 0.48) / 1.2)
  context.scale(1, 1 / 1.2)

  context.font = 'bold 40px sans-serif'
  context.fillText('U.S.M.C.', width * 0.5, height * 0.53)

  const decalTexture = new THREE.CanvasTexture(canvas)
  decalTexture.colorSpace = THREE.SRGBColorSpace
  decalTexture.anisotropy = 16
  decalTexture.needsUpdate = true

  return decalTexture
}

function createTarsMaterial(decalTexture, options = {}) {
  const material = new THREE.MeshStandardNodeMaterial()

  const baseColor = color(0.55, 0.55, 0.55)
  const darkColor = color(0.1, 0.1, 0.1)
  const baseMetalness = float(0.85)
  const currentUv = uv()

  const noise = fract(sin(currentUv.x.mul(800.0).add(currentUv.y.mul(20.0))).mul(43758.5453))
  const baseRoughness = mix(float(0.3), float(0.45), noise)

  const gridScale = vec2(3.0, 30.0)
  const gridUv = currentUv.mul(gridScale)
  const lineThickness = float(0.08)

  const gridX = step(lineThickness, fract(gridUv.x)).mul(step(lineThickness, float(1.0).sub(fract(gridUv.x))))
  const gridY = step(lineThickness, fract(gridUv.y)).mul(step(lineThickness, float(1.0).sub(fract(gridUv.y))))
  const isGridSquare = gridX.mul(gridY)
  const isGroove = float(1.0).sub(isGridSquare)

  const isTopOrBottom = max(step(float(0.88), currentUv.y), step(currentUv.y, float(0.12)))
  const isVerticalFace = step(float(0.5), normalLocal.x.abs().add(normalLocal.z.abs()))
  const finalGroove = isGroove.mul(isTopOrBottom).mul(isVerticalFace)

  let finalColor = mix(baseColor, darkColor, finalGroove.mul(float(0.8)))
  let finalRoughness = mix(baseRoughness, float(0.9), finalGroove)

  if (options.hasDecals) {
    const decalNode = texture(decalTexture)
    const isFrontFace = step(float(0.9), normalLocal.z)
    const hasDecal = step(float(0.1), decalNode.a).mul(isFrontFace)
    const isScreen = step(decalNode.r, float(0.1)).mul(hasDecal)

    finalColor = mix(finalColor, decalNode, hasDecal)
    finalRoughness = mix(finalRoughness, float(0.05), isScreen)
    material.metalnessNode = mix(baseMetalness, float(0.0), isScreen)
  } else {
    material.metalnessNode = baseMetalness
  }

  if (options.hasCircle) {
    const isRightFace = step(float(0.9), normalLocal.x)
    const centerDistance = length(currentUv.sub(vec2(0.5, 0.65)))

    const outerCircle = step(centerDistance, float(0.15))
    const innerCircle = step(centerDistance, float(0.13))
    const centerHole = step(centerDistance, float(0.05))

    const jointGroove = max(outerCircle.sub(innerCircle), centerHole).mul(isRightFace)

    finalColor = mix(finalColor, darkColor, jointGroove)
    finalRoughness = mix(finalRoughness, float(0.8), jointGroove)
  }

  material.colorNode = finalColor
  material.roughnessNode = finalRoughness

  return material
}

function createTars(decalTexture) {
  const width = 0.65
  const height = 5.0
  const depth = 0.65
  const gap = 0.02

  const legGeometry = new THREE.BoxGeometry(width, height, depth)
  const baseMaterial = createTarsMaterial(decalTexture)
  const decalMaterial = createTarsMaterial(decalTexture, { hasDecals: true })
  const circleMaterial = createTarsMaterial(decalTexture, { hasCircle: true })

  const tars = new THREE.Group()
  tars.name = 'miller-tars'

  const angleForward = 0.25
  const angleBackward = -0.25

  const leg1 = new THREE.Mesh(legGeometry, baseMaterial)
  leg1.position.x = -width * 1.5 - gap * 1.5
  leg1.rotation.x = angleForward
  tars.add(leg1)

  const leg2 = new THREE.Mesh(legGeometry, decalMaterial)
  leg2.position.x = -width * 0.5 - gap * 0.5
  leg2.rotation.x = angleBackward
  tars.add(leg2)

  const leg3 = new THREE.Mesh(legGeometry, baseMaterial)
  leg3.position.x = width * 0.5 + gap * 0.5
  leg3.rotation.x = angleBackward
  tars.add(leg3)

  const leg4 = new THREE.Mesh(legGeometry, circleMaterial)
  leg4.position.x = width * 1.5 + gap * 1.5
  leg4.rotation.x = angleForward
  tars.add(leg4)

  tars.position.y = height / 2
  return tars
}

function proceduralNoise(positionNode, scale) {
  const scaled = positionNode.mul(scale)
  return fract(sin(dot(scaled, vec3(12.9898, 78.233, 37.719))).mul(43758.5453))
}

function createRangerHullMaterial() {
  const material = new THREE.MeshStandardNodeMaterial()
  const localPosition = positionLocal

  const scaleX = 0.8
  const scaleZ = 0.5
  const gridX = step(0.96, fract(localPosition.x.mul(scaleX)))
  const gridZ = step(0.96, fract(localPosition.z.mul(scaleZ)))
  const lines = max(gridX, gridZ)

  const wear = proceduralNoise(localPosition, float(15.0)).mul(0.1)
  const baseWhite = color(0xeceef0)
  const dirtyWhite = color(0xd0d5da)
  const lineColor = color(0x606060)

  let finalColor = mix(baseWhite, dirtyWhite, wear)
  finalColor = mix(finalColor, lineColor, lines)

  const isNose = step(float(8.2), localPosition.z)
  const isRearTop = step(localPosition.z, float(-4.0)).mul(step(float(0.8), localPosition.y))
  const decals = max(isNose, isRearTop.mul(proceduralNoise(localPosition, float(5.0)).mul(0.5)))
  finalColor = mix(finalColor, color(0x222222), decals)

  material.colorNode = finalColor
  material.roughnessNode = float(0.4).add(wear).add(lines.mul(0.4))
  material.metalnessNode = float(0.15)
  return material
}

function createRangerBlackTrimMaterial() {
  const material = new THREE.MeshStandardNodeMaterial()
  const wear = proceduralNoise(positionLocal, float(25.0)).mul(0.08)
  material.colorNode = color(0x151618).add(wear)
  material.roughnessNode = float(0.85).sub(wear)
  material.metalnessNode = float(0.3)
  return material
}

function createRangerWindowMaterial() {
  const material = new THREE.MeshStandardNodeMaterial()
  material.colorNode = color(0x010203)
  material.roughnessNode = float(0.02)
  material.metalnessNode = float(0.95)
  return material
}

function buildRangerCoreHull() {
  const shipLength = 18
  const shipWidth = 8.5
  const geometry = new THREE.BoxGeometry(1, 1, 1, 16, 4, 32)
  const positions = geometry.attributes.position

  for (let index = 0; index < positions.count; index += 1) {
    const nx = positions.getX(index) * 2
    const ny = positions.getY(index) * 2
    const nz = positions.getZ(index) * 2
    const finalZ = nz * (shipLength / 2)

    let halfWidth = 0
    if (finalZ < -3) {
      halfWidth = shipWidth / 2
    } else if (finalZ < 6) {
      halfWidth = THREE.MathUtils.lerp(shipWidth / 2, 1.2, (finalZ + 3) / 9)
    } else {
      halfWidth = THREE.MathUtils.lerp(1.2, 0.3, (finalZ - 6) / 3)
    }

    halfWidth *= 1.0 - Math.pow(Math.abs(nz), 4) * 0.05
    const finalX = nx * halfWidth

    let finalY = 0
    if (ny > 0) {
      if (finalZ < -4) {
        finalY = 1.0
      } else if (finalZ < 1) {
        finalY = THREE.MathUtils.lerp(1.0, 2.2, (finalZ + 4) / 5)
      } else if (finalZ < 7) {
        finalY = THREE.MathUtils.lerp(2.2, 0.4, (finalZ - 1) / 6)
      } else {
        finalY = THREE.MathUtils.lerp(0.4, 0.1, (finalZ - 7) / 2)
      }

      const edgeThinness = Math.pow(Math.abs(nx), 1.5)
      const edgeHeight = THREE.MathUtils.lerp(0.8, 0.1, (finalZ + 9) / 18)
      finalY = THREE.MathUtils.lerp(finalY, edgeHeight, edgeThinness)
    } else {
      finalY = -0.1 + ((finalZ + 9) / 18) * 0.2
    }

    positions.setXYZ(index, finalX, finalY, finalZ)
  }

  geometry.computeVertexNormals()
  return geometry
}

function createRangerShip() {
  const rangerRig = new THREE.Group()
  rangerRig.name = 'miller-ranger'

  const ship = new THREE.Group()
  const hullMaterial = createRangerHullMaterial()
  const blackTrimMaterial = createRangerBlackTrimMaterial()
  const windowMaterial = createRangerWindowMaterial()

  ship.add(new THREE.Mesh(buildRangerCoreHull(), hullMaterial))

  const buildSideCowl = (isLeft) => {
    const cowlGroup = new THREE.Group()
    const side = isLeft ? 1 : -1

    const rearArm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 6.0), blackTrimMaterial)
    rearArm.position.set(4.0 * side, 0.3, -5.0)
    rearArm.rotation.y = 0.05 * side
    cowlGroup.add(rearArm)

    const midArm = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 6.5), blackTrimMaterial)
    midArm.position.set(3.0 * side, 0.2, 0.5)
    midArm.rotation.y = -0.28 * side
    cowlGroup.add(midArm)

    const frontArm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 4.0), blackTrimMaterial)
    frontArm.position.set(1.4 * side, 0.1, 5.0)
    frontArm.rotation.y = -0.45 * side
    cowlGroup.add(frontArm)

    return cowlGroup
  }

  ship.add(buildSideCowl(true))
  ship.add(buildSideCowl(false))

  const rearChassis = new THREE.Mesh(new THREE.BoxGeometry(8.2, 1.4, 1.2), blackTrimMaterial)
  rearChassis.position.set(0, 0.4, -8.6)
  ship.add(rearChassis)

  const mainSlopeAngle = Math.atan2(1.8, 6.0)

  const placeFlushWindow = (width, height, depth, x, z, rotationY = 0) => {
    const nz = z / 9.0
    let halfWidth = THREE.MathUtils.lerp(4.25, 1.2, (z + 3) / 9)
    halfWidth *= 1.0 - Math.pow(Math.abs(nz), 4) * 0.05

    const nx = Math.min(Math.abs(x) / halfWidth, 1.0)
    const centerY = THREE.MathUtils.lerp(2.2, 0.4, (z - 1) / 6)
    const edgeThinness = Math.pow(nx, 1.5)
    const edgeHeight = THREE.MathUtils.lerp(0.8, 0.1, (z + 9) / 18)
    const finalY = THREE.MathUtils.lerp(centerY, edgeHeight, edgeThinness)

    const nx2 = Math.min((Math.abs(x) + 0.1) / halfWidth, 1.0)
    const finalY2 = THREE.MathUtils.lerp(centerY, edgeHeight, Math.pow(nx2, 1.5))
    const rotationZ = Math.atan2(finalY2 - finalY, 0.1) * Math.sign(-x)

    const pane = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), windowMaterial)
    pane.position.set(x, finalY - height / 2 + 0.02, z)
    pane.rotation.set(mainSlopeAngle, rotationY, rotationZ)
    ship.add(pane)
  }

  placeFlushWindow(0.7, 0.1, 0.8, -0.8, 1.8, -0.1)
  placeFlushWindow(0.7, 0.1, 0.8, 0.0, 1.8, 0)
  placeFlushWindow(0.7, 0.1, 0.8, 0.8, 1.8, 0.1)

  placeFlushWindow(0.9, 0.1, 0.9, -1.0, 3.0, -0.15)
  placeFlushWindow(0.9, 0.1, 0.9, 0.0, 3.0, 0)
  placeFlushWindow(0.9, 0.1, 0.9, 1.0, 3.0, 0.15)

  placeFlushWindow(1.0, 0.1, 1.0, -1.2, 4.2, -0.2)
  placeFlushWindow(1.0, 0.1, 1.0, 0.0, 4.2, 0)
  placeFlushWindow(1.0, 0.1, 1.0, 1.2, 4.2, 0.2)

  const roofAngle = -Math.atan2(1.2, 5.0)
  const placeRoofWindow = (x, z) => {
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 1.0), windowMaterial)
    pane.position.set(x, 1.95, z)
    pane.rotation.set(roofAngle, 0, x > 0 ? -0.1 : 0.1)
    ship.add(pane)
  }

  placeRoofWindow(-0.7, 0.2)
  placeRoofWindow(0.7, 0.2)

  const rearGear = new THREE.Group()

  const rearShock = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 1.8, 8), hullMaterial)
  rearShock.position.set(0, -1.5, 0)
  rearGear.add(rearShock)

  const rearStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 8), blackTrimMaterial)
  rearStrut.rotation.x = -Math.PI / 4
  rearStrut.position.set(0, -0.8, -0.6)
  rearGear.add(rearStrut)

  const rearJoint = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.4), blackTrimMaterial)
  rearJoint.position.set(0, -0.6, 0)
  rearGear.add(rearJoint)

  const rearSkid = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.15, 2.2), blackTrimMaterial)
  rearSkid.position.set(0, -2.4, 0)
  rearGear.add(rearSkid)

  rearGear.position.set(3.2, 0.2, -4.5)
  ship.add(rearGear)

  const rearGearLeft = rearGear.clone()
  rearGearLeft.position.set(-3.2, 0.2, -4.5)
  ship.add(rearGearLeft)

  const frontGear = new THREE.Group()
  const frontShock = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 1.6, 8), hullMaterial)
  frontShock.position.set(0, -1.4, 0)
  frontGear.add(frontShock)

  const frontStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8), blackTrimMaterial)
  frontStrut.rotation.x = Math.PI / 4
  frontStrut.position.set(0, -0.8, 0.4)
  frontGear.add(frontStrut)

  const frontSkid = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 1.5), blackTrimMaterial)
  frontSkid.position.set(0, -2.2, 0)
  frontGear.add(frontSkid)

  frontGear.position.set(0, 0.6, 5.5)
  ship.add(frontGear)

  ship.rotation.x = -0.04
  ship.position.y = 2.22
  rangerRig.add(ship)

  return rangerRig
}

function createTidalWave() {
  const waveGeometry = new THREE.PlaneGeometry(420, 152, WAVE_GEOMETRY_WIDTH_SEGMENTS, WAVE_GEOMETRY_HEIGHT_SEGMENTS)
  const positions = waveGeometry.attributes.position
  const vertexCount = positions.count
  const basePositions = new Float32Array(positions.array.length)
  basePositions.set(positions.array)

  for (let index = 0; index < vertexCount; index += 1) {
    const x = positions.getX(index)
    const y = positions.getY(index)

    const horizonBulge = Math.sin(x * 0.021) * 2.8
    const curl = Math.max(0, y - 24.0) * 0.56
    const jagged = Math.sin(x * 0.17 + y * 0.11) * 2.35 + Math.cos(x * 0.12 - y * 0.05) * 1.4

    positions.setZ(index, horizonBulge + curl + jagged)
  }

  positions.needsUpdate = true
  waveGeometry.computeVertexNormals()

  const waveMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x253641,
    roughness: 0.14,
    metalness: 0.05,
    transmission: 0.07,
    thickness: 1.2,
    clearcoat: 0.9,
    clearcoatRoughness: 0.26,
    reflectivity: 0.88,
    ior: 1.33,
    transparent: true,
    opacity: 0.94,
  })

  const wave = new THREE.Mesh(waveGeometry, waveMaterial)
  wave.position.set(0, 46, 232)

  const foamGeometry = waveGeometry.clone()
  const foamMaterial = new THREE.MeshStandardMaterial({
    color: 0xe4edf3,
    roughness: 0.46,
    metalness: 0.05,
    transparent: true,
    opacity: 0.26,
  })

  const foam = new THREE.Mesh(foamGeometry, foamMaterial)
  foam.position.set(0, 90.5, 227.5)
  foam.scale.set(1.0, 0.18, 1.0)

  return { basePositions, wave, foam }
}

function updateAstronautPose(astronaut, elapsed, strideScale, turnBias = 0) {
  if (!astronaut?.userData?.pose) {
    return
  }

  const stride = Math.sin(elapsed * 1.6 + strideScale) * 0.33
  const settle = Math.sin(elapsed * 3.8 + strideScale * 2.6) * 0.045

  astronaut.position.y = astronaut.userData.pose.neutralY + settle
  astronaut.rotation.y = turnBias + Math.sin(elapsed * 0.27 + strideScale) * 0.05
  astronaut.userData.pose.leftArm.rotation.x = -0.25 + stride * 0.45
  astronaut.userData.pose.rightArm.rotation.x = 0.22 - stride * 0.42
  astronaut.userData.pose.leftLeg.rotation.x = 0.18 - stride * 0.58
  astronaut.userData.pose.rightLeg.rotation.x = -0.16 + stride * 0.52
}

function updateTidalWaveGeometry(basePositions, mesh, elapsed, intensity = 1) {
  if (!basePositions || !mesh?.geometry?.attributes?.position) {
    return
  }

  const positions = mesh.geometry.attributes.position
  const vertexCount = positions.count
  const phase = elapsed * 0.62

  for (let index = 0; index < vertexCount; index += 1) {
    const baseX = basePositions[index * 3]
    const baseY = basePositions[index * 3 + 1]
    const baseZ = basePositions[index * 3 + 2]

    const rolling = Math.sin(baseX * 0.086 + phase + baseY * 0.17) * 2.6 * intensity
    const lateral = Math.cos(baseX * 0.042 - phase * 0.42 + baseY * 0.14) * 2.9 * intensity
    const crest = Math.max(0, baseY - 23.0) * 0.11 * (1.0 + Math.sin(phase * 0.8) * 0.3)

    positions.setZ(index, baseZ + rolling + lateral + crest)
  }

  positions.needsUpdate = true
  mesh.geometry.computeVertexNormals()
}

export default {
  id: 'millers-planet-wave',
  title: "Miller's Planet and Wave",
  create() {
    let group = null
    let rootRef = null

    let skyDome = null
    let water = null
    let oceanTimeUniform = null
    let wave = null
    let foam = null
    let waveBasePositions = null
    let foamBasePositions = null
    let astronautA = null
    let astronautB = null
    let ranger = null
    let tars = null
    let tarsDecalTexture = null

    let previousFog = null
    let previousBackground = null

    return {
      init({ root, camera, scene }) {
        rootRef = root
        group = new THREE.Group()
        group.name = 'scene-millers-planet-wave'
        root.add(group)

        previousFog = scene.fog
        previousBackground = scene.background

        scene.background = new THREE.Color(0x020c18)
        scene.fog = new THREE.FogExp2(0xb8c1c8, 0.0068)

        const ambientLight = new THREE.HemisphereLight(0xe4eaee, 0x4c606d, 1.0)
        group.add(ambientLight)

        const sunLight = new THREE.DirectionalLight(0xf5f2eb, 1.95)
        sunLight.position.set(-18, 27, 11)
        group.add(sunLight)

        const fillLight = new THREE.DirectionalLight(0xbacdd9, 0.68)
        fillLight.position.set(10, 7, -8)
        group.add(fillLight)

        const oceanShaderSet = createOceanShaderSet()
        skyDome = oceanShaderSet.skyMesh
        water = oceanShaderSet.oceanMesh
        oceanTimeUniform = oceanShaderSet.timeU

        group.add(skyDome)
        group.add(water)

        const tidalWaveSet = createTidalWave()
        wave = tidalWaveSet.wave
        foam = tidalWaveSet.foam
        waveBasePositions = tidalWaveSet.basePositions
        foamBasePositions = new Float32Array(foam.geometry.attributes.position.array)

        group.add(wave)
        group.add(foam)

        astronautA = createAstronaut()
        astronautA.position.set(-1.9, -0.54, 2.8)
        astronautA.rotation.y = -0.12
        astronautA.userData.pose.neutralY = astronautA.position.y
        group.add(astronautA)

        astronautB = createAstronaut()
        astronautB.scale.setScalar(0.96)
        astronautB.position.set(1.85, -0.78, 6.15)
        astronautB.rotation.y = 0.34
        astronautB.userData.pose.neutralY = astronautB.position.y
        group.add(astronautB)

        tarsDecalTexture = createTarsDecalTexture()
        tars = createTars(tarsDecalTexture)
        tars.position.set(6.35, 2.05, 5.15)
        tars.rotation.y = 4
        group.add(tars)

        ranger = createRangerShip()
        ranger.scale.setScalar(2)
        ranger.position.set(0.8, -2, 22.6)
        ranger.rotation.y = -Math.PI / 2
        group.add(ranger)

        camera.position.set(1.8, 3.2, -5.6)
        camera.lookAt(0.2, 1.5, 10.8)
      },

      update({ elapsed, camera }) {
        if (oceanTimeUniform) {
          oceanTimeUniform.value = elapsed * 0.55
        }

        if (camera) {
          const surfaceY = getOceanSurfaceHeightAt(camera.position.x, camera.position.z, elapsed * 0.55)
          const minimumCameraY = surfaceY + CAMERA_WATER_CLEARANCE
          if (camera.position.y < minimumCameraY) {
            camera.position.y = minimumCameraY
          }
        }

        if (wave) {
          const waveAdvance = (Math.sin(elapsed * 0.16) * 0.5 + 0.5) * 1.0
          wave.position.z = THREE.MathUtils.lerp(238, 118, waveAdvance)
          wave.position.x = Math.sin(elapsed * 0.05) * 7.8
          wave.rotation.y = Math.sin(elapsed * 0.07) * 0.055
          updateTidalWaveGeometry(waveBasePositions, wave, elapsed, 1.0)
        }

        if (foam) {
          foam.position.z = wave ? wave.position.z - 4.2 : foam.position.z
          foam.position.x = wave ? wave.position.x : foam.position.x
          foam.rotation.y = wave ? wave.rotation.y : foam.rotation.y
          updateTidalWaveGeometry(foamBasePositions, foam, elapsed + 0.85, 0.8)
        }

        updateAstronautPose(astronautA, elapsed, 0.0, -0.12)
        updateAstronautPose(astronautB, elapsed, 1.6, 0.34)
      },

      resize() {},

      dispose({ scene }) {
        scene.fog = previousFog
        scene.background = previousBackground

        if (tarsDecalTexture) {
          tarsDecalTexture.dispose()
          tarsDecalTexture = null
        }

        if (group) {
          if (rootRef && group.parent !== rootRef) {
            rootRef.add(group)
          }

          disposeObject3D(group)
        }

        group = null
        rootRef = null
        skyDome = null
        water = null
        oceanTimeUniform = null
        wave = null
        foam = null
        waveBasePositions = null
        foamBasePositions = null
        astronautA = null
        astronautB = null
        ranger = null
        tars = null
        previousFog = null
        previousBackground = null
      },
    }
  },
}
