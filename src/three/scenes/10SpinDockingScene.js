import * as THREE from 'three/webgpu'
import {
  abs,
  cameraPosition,
  clamp,
  color,
  dot,
  exp,
  Fn,
  float,
  fract,
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
  sin,
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
const CAMERA_NEAR = 35
const CAMERA_FAR = 90000
const CAMERA_ORBIT_ALTITUDE_KM = 940

const ATMOSPHERE_VIEW_SAMPLES = 18
const ATMOSPHERE_LIGHT_SAMPLES = 10
const ATMOSPHERE_VISUAL_THICKNESS_BOOST = 1.7

const SHIP_CAMERA_DISTANCE = 340
const SHIP_STAGING_CAMERA_POSITION = new THREE.Vector3(6895.770, 4931.842, 6170.045)
const SHIP_STAGING_CAMERA_LOOK_AT = new THREE.Vector3(6480.178, 4737.868, 5281.418)
const ENDURANCE_OFFSET_RIGHT = 56
const ENDURANCE_OFFSET_UP = -8
const RANGER_OFFSET_RIGHT = -96
const RANGER_OFFSET_UP = 6
const RANGER_OFFSET_FORWARD = -188
const ENDURANCE_SPIN_RATE = 3.15
const RANGER_SPIN_UP_DURATION = 6.5
const RANGER_APPROACH_START = 4.0
const RANGER_APPROACH_DURATION = 14.5
const RANGER_DOCK_SETTLE_DURATION = 3.0
const RANGER_POST_DOCK_SPINDOWN_DURATION = 3.0
const RANGER_DOCK_CLEARANCE = 4.1
const RANGER_DOCK_RADIAL_OFFSET = 0.35
const ENDURANCE_DOCK_PORT_LOCAL = new THREE.Vector3(0, 0, 1.5)
const LOCAL_FORWARD_Z = new THREE.Vector3(0, 0, 1)
const ENDURANCE_DEBRIS_SOURCE_ANGLE = (4.5 / 12) * Math.PI * 2
const ENDURANCE_DEBRIS_COUNT = 24
const ENDURANCE_DEBRIS_RADIUS_MIN = 28
const ENDURANCE_DEBRIS_RADIUS_MAX = 37
const ENDURANCE_DEBRIS_Z_MIN = -2.6
const ENDURANCE_DEBRIS_Z_MAX = 2.6
const ENDURANCE_DEBRIS_ANGLE_SPREAD = 0.95
const ENDURANCE_DEBRIS_PEEL_DELAY_MIN = 0.2
const ENDURANCE_DEBRIS_PEEL_DELAY_MAX = 8.8
const ENDURANCE_DEBRIS_PEEL_DURATION_MIN = 0.45
const ENDURANCE_DEBRIS_PEEL_DURATION_MAX = 1.25
const ENDURANCE_DEBRIS_PEEL_DISTANCE_MIN = 0.9
const ENDURANCE_DEBRIS_PEEL_DISTANCE_MAX = 2.8
const ENDURANCE_DEBRIS_OUTWARD_SPEED_MIN = 2.2
const ENDURANCE_DEBRIS_OUTWARD_SPEED_MAX = 8.2
const ENDURANCE_DEBRIS_AXIAL_SPEED_MAX = 1.8
const ENDURANCE_DEBRIS_LIFETIME_MIN = 10.5
const ENDURANCE_DEBRIS_LIFETIME_MAX = 18.5
const ENDURANCE_DEBRIS_RESPAWN_DELAY_MIN = 1.8
const ENDURANCE_DEBRIS_RESPAWN_DELAY_MAX = 5.4
const ENDURANCE_DEBRIS_MAX_SPEED = 95
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
const TMP_VEC3_E = new THREE.Vector3()
const TMP_VEC3_G = new THREE.Vector3()
const TMP_VEC3_H = new THREE.Vector3()
const TMP_VEC3_I = new THREE.Vector3()
const TMP_VEC3_J = new THREE.Vector3()
const TMP_VEC3_K = new THREE.Vector3()
const UP_VECTOR = new THREE.Vector3(0, 1, 0)
const TMP_QUAT_A = new THREE.Quaternion()
const TMP_QUAT_B = new THREE.Quaternion()
const TMP_QUAT_C = new THREE.Quaternion()
const TMP_QUAT_D = new THREE.Quaternion()
const TMP_QUAT_E = new THREE.Quaternion()

function smoothstepRange(edge0, edge1, value) {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1
  }

  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function integrateSpringVector(current, velocity, target, delta, stiffness, damping) {
  TMP_VEC3_G.copy(target).sub(current).multiplyScalar(stiffness)
  TMP_VEC3_G.addScaledVector(velocity, -damping)
  velocity.addScaledVector(TMP_VEC3_G, delta)
  current.addScaledVector(velocity, delta)
}

function applyDepthBias(object3D, factor, units) {
  object3D.traverse((node) => {
    if (!node.isMesh || !node.material) {
      return
    }

    const applyToMaterial = (material) => {
      material.polygonOffset = true
      material.polygonOffsetFactor = factor
      material.polygonOffsetUnits = units
      material.needsUpdate = true
    }

    if (Array.isArray(node.material)) {
      for (const material of node.material) {
        applyToMaterial(material)
      }
    } else {
      applyToMaterial(node.material)
    }
  })
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
  stars.name = 'scene10-space-stars'
  return stars
}

function createMetalMat(hexColor, roughness, metalness) {
  const material = new THREE.MeshStandardNodeMaterial()
  material.colorNode = color(hexColor)
  material.roughnessNode = float(roughness)
  material.metalnessNode = float(metalness)
  return material
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

  const nx = 16
  const ny = 14
  const xMin = -4.0
  const xMax = 4.0
  const yMin = -3.5
  const yMax = 3.5
  const verts = []
  const indexArr = []
  const vertexIndex = (ix, iy) => ix * (ny + 1) + iy

  for (let ix = 0; ix <= nx; ix += 1) {
    for (let iy = 0; iy <= ny; iy += 1) {
      const x = xMin + (ix / nx) * (xMax - xMin)
      const y = yMin + (iy / ny) * (yMax - yMin)
      let zOffset = 0.05

      if (ix > 0 && ix < nx && iy > 0 && iy < ny) {
        const seed = ix * 31 + iy * 17
        const noise = Math.sin(ix * 2.1 + iy * 1.3) * 1.1
          + Math.cos(ix * 4.7 - iy * 2.9) * 0.7
          + (seededRand(seed) - 0.5) * 1.2
        zOffset = 0.05 + Math.abs(noise)
      }

      verts.push(x, y, zOffset)
    }
  }

  for (let ix = 0; ix < nx; ix += 1) {
    for (let iy = 0; iy < ny; iy += 1) {
      const a = vertexIndex(ix, iy)
      const b = vertexIndex(ix + 1, iy)
      const c = vertexIndex(ix + 1, iy + 1)
      const d = vertexIndex(ix, iy + 1)
      indexArr.push(a, b, c, a, c, d)
    }
  }

  const tornGeo = new THREE.BufferGeometry()
  tornGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  tornGeo.setIndex(indexArr)
  tornGeo.computeVertexNormals()

  const tornFace = new THREE.Mesh(tornGeo, matTornFace)
  tornFace.castShadow = true
  group.add(tornFace)

  const numShards = 20
  for (let shardIndex = 0; shardIndex < numShards; shardIndex += 1) {
    const t = shardIndex / (numShards - 1)
    const angle = t * Math.PI * 2
    const x = Math.cos(angle) * 3.8
    const y = Math.sin(angle) * 3.3

    const r1 = seededRand(shardIndex * 7)
    const r2 = seededRand(shardIndex * 7 + 1)
    const r3 = seededRand(shardIndex * 7 + 2)
    const r4 = seededRand(shardIndex * 7 + 3)

    const shardW = 0.4 + r1 * 1.5
    const shardH = 0.3 + r2 * 1.2
    const shardD = 0.3 + r3 * 1.0
    const zOffset = 0.1 + r4 * 1.5

    const shard = new THREE.Mesh(new THREE.BoxGeometry(shardW, shardH, shardD), matWhiteHull)
    shard.position.set(x, y, zOffset)
    shard.rotation.x = (r1 - 0.5) * 1.5
    shard.rotation.y = (r2 - 0.5) * 1.5
    shard.rotation.z = angle + (r3 - 0.5) * 0.5
    shard.castShadow = true
    group.add(shard)
  }

  return group
}

function createDamagedEndurance() {
  const endurance = new THREE.Group()
  endurance.name = 'scene10-endurance-damaged'

  const matWhiteHull = createMetalMat(0xdddddd, 0.4, 0.6)
  const matDarkHull = createMetalMat(0x333333, 0.5, 0.7)
  const matSolarPanel = createMetalMat(0x111111, 0.15, 0.9)
  const matGlossBlack = createMetalMat(0x050505, 0.05, 0.8)
  const matStump = createMetalMat(0x222222, 0.9, 0.3)
  const matTornFace = createMetalMat(0x1a1a1a, 0.85, 0.45)

  const ringRadius = 32
  const moduleCount = 12
  const idxBlown = 4
  const idxPartial = 5

  for (let i = 0; i < moduleCount; i += 1) {
    const angle = (i / moduleCount) * Math.PI * 2
    const mx = Math.cos(angle) * ringRadius
    const my = Math.sin(angle) * ringRadius

    if (i === idxBlown) {
      const stumpGroup = new THREE.Group()
      const stump = new THREE.Mesh(new THREE.BoxGeometry(8, 7, 1.2), matStump)
      stump.castShadow = true
      stumpGroup.add(stump)

      const shards = [
        { w: 0.8, h: 3.0, d: 0.35, x: 2.4, y: 1.8, z: 0.55, rx: 0.2, rz: 0.3 },
        { w: 0.5, h: 1.8, d: 0.3, x: -2.1, y: -2.2, z: 0.55, rx: -0.1, rz: -0.2 },
        { w: 0.9, h: 1.4, d: 0.35, x: 2.7, y: -1.3, z: 0.5, rx: 0.25, rz: 0.35 },
        { w: 0.4, h: 2.3, d: 0.28, x: -2.9, y: 1.0, z: 0.5, rx: -0.15, rz: -0.28 },
        { w: 0.7, h: 0.9, d: 0.4, x: 0.3, y: 2.7, z: 0.45, rx: 0.1, rz: 0.18 },
      ]

      for (const shardDef of shards) {
        const shard = new THREE.Mesh(
          new THREE.BoxGeometry(shardDef.w, shardDef.h, shardDef.d),
          matStump,
        )
        shard.position.set(shardDef.x, shardDef.y, shardDef.z)
        shard.rotation.set(shardDef.rx, 0, shardDef.rz)
        shard.castShadow = true
        stumpGroup.add(shard)
      }

      stumpGroup.position.set(mx, my, 0)
      stumpGroup.rotation.z = angle + Math.PI / 2
      stumpGroup.lookAt(0, 0, 0)
      endurance.add(stumpGroup)
    } else if (i === idxPartial) {
      const partialModule = buildTornHalfPod({
        matDarkHull,
        matSolarPanel,
        matTornFace,
        matWhiteHull,
      })
      partialModule.position.set(mx, my, 0)
      partialModule.rotation.z = angle + Math.PI / 2
      partialModule.lookAt(0, 0, 0)
      partialModule.rotateY(Math.PI)
      endurance.add(partialModule)
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

    const jointAngle = angle + (Math.PI / moduleCount)
    const jx = Math.cos(jointAngle) * ringRadius
    const jy = Math.sin(jointAngle) * ringRadius

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

  const poleLength = ringRadius - 5
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

  endurance.userData.hullMaterial = matWhiteHull

  return endurance
}

function createEndurancePeelingDebris(hullMaterial) {
  const group = new THREE.Group()
  group.name = 'scene10-endurance-peeling-debris'

  const debrisMaterial = hullMaterial ?? createMetalMat(0xdddddd, 0.4, 0.6)
  const pieces = []

  for (let pieceIndex = 0; pieceIndex < ENDURANCE_DEBRIS_COUNT; pieceIndex += 1) {
    const sizeSeed = pieceIndex * 13
    const sizeA = 0.45 + seededRand(sizeSeed + 1) * 1.25
    const sizeB = 0.35 + seededRand(sizeSeed + 2) * 0.9
    const sizeC = 0.35 + seededRand(sizeSeed + 3) * 1.05
    const shapeSelector = seededRand(sizeSeed + 4)

    let geometry = null
    if (shapeSelector < 0.58) {
      geometry = new THREE.BoxGeometry(sizeA, sizeB, sizeC)
    } else if (shapeSelector < 0.86) {
      geometry = new THREE.CylinderGeometry(sizeA * 0.28, sizeA * 0.55, sizeC, 4, 1)
    } else {
      geometry = new THREE.TetrahedronGeometry(sizeA * 0.58, 0)
    }

    const mesh = new THREE.Mesh(geometry, debrisMaterial)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)

    pieces.push({
      angularVelocity: new THREE.Vector3(),
      axialSpeed: 0,
      detachTime: 0,
      lifetime: 0,
      localAnchor: new THREE.Vector3(),
      localBaseQuaternion: new THREE.Quaternion(),
      localOutward: new THREE.Vector3(),
      localTangent: new THREE.Vector3(),
      maxPeelDistance: 0,
      mesh,
      outwardSpeed: 0,
      peelStartTime: 0,
      peelTwist: 0,
      released: false,
      releasedAge: 0,
      rollRate: 0,
      spinCarry: 0,
      tumbleRate: 0,
      velocity: new THREE.Vector3(),
    })
  }

  return { group, pieces }
}

function proceduralNoise(positionNode, scale) {
  const scaled = positionNode.mul(scale)
  return fract(sin(dot(scaled, vec3(12.9898, 78.233, 37.719))).mul(43758.5453))
}

function createRangerHullMaterial() {
  const material = new THREE.MeshStandardNodeMaterial()
  const pos = positionLocal

  const scaleX = 0.8
  const scaleZ = 0.5
  const gridX = step(0.96, fract(pos.x.mul(scaleX)))
  const gridZ = step(0.96, fract(pos.z.mul(scaleZ)))
  const lines = max(gridX, gridZ)

  const wear = proceduralNoise(pos, float(15.0)).mul(0.1)
  const baseWhite = color(0xeceef0)
  const dirtyWhite = color(0xd0d5da)
  const lineColor = color(0x606060)

  let finalColor = mix(baseWhite, dirtyWhite, wear)
  finalColor = mix(finalColor, lineColor, lines)

  const isNose = step(float(8.2), pos.z)
  const isRearTop = step(pos.z, float(-4.0)).mul(step(float(0.8), pos.y))
  const decals = max(isNose, isRearTop.mul(proceduralNoise(pos, float(5.0)).mul(0.5)))
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
  const position = geometry.attributes.position

  for (let i = 0; i < position.count; i += 1) {
    const nx = position.getX(i) * 2
    const ny = position.getY(i) * 2
    const nz = position.getZ(i) * 2
    const finalZ = nz * (shipLength / 2)

    let halfWidth = 0
    if (finalZ < -3) {
      halfWidth = shipWidth / 2
    } else if (finalZ < 6) {
      halfWidth = THREE.MathUtils.lerp(shipWidth / 2, 1.2, (finalZ + 3) / 9)
    } else {
      halfWidth = THREE.MathUtils.lerp(1.2, 0.3, (finalZ - 6) / 3)
    }

    halfWidth *= (1.0 - Math.pow(Math.abs(nz), 4) * 0.05)
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

    position.setXYZ(i, finalX, finalY, finalZ)
  }

  geometry.computeVertexNormals()
  return geometry
}

function createRangerShipWithoutLandingLegs() {
  const ship = new THREE.Group()
  ship.name = 'scene10-ranger'

  const matHull = createRangerHullMaterial()
  const matBlack = createRangerBlackTrimMaterial()
  const matGlass = createRangerWindowMaterial()

  ship.add(new THREE.Mesh(buildRangerCoreHull(), matHull))

  const buildSideCowl = (isLeft) => {
    const cowlGroup = new THREE.Group()
    const sign = isLeft ? 1 : -1

    const rearArm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 6.0), matBlack)
    rearArm.position.set(4.0 * sign, 0.3, -5.0)
    rearArm.rotation.y = 0.05 * sign
    cowlGroup.add(rearArm)

    const midArm = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 6.5), matBlack)
    midArm.position.set(3.0 * sign, 0.2, 0.5)
    midArm.rotation.y = -0.28 * sign
    cowlGroup.add(midArm)

    const frontArm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 4.0), matBlack)
    frontArm.position.set(1.4 * sign, 0.1, 5.0)
    frontArm.rotation.y = -0.45 * sign
    cowlGroup.add(frontArm)

    return cowlGroup
  }

  ship.add(buildSideCowl(true))
  ship.add(buildSideCowl(false))

  const tail = new THREE.Mesh(new THREE.BoxGeometry(8.2, 1.4, 1.2), matBlack)
  tail.position.set(0, 0.4, -8.6)
  ship.add(tail)

  const mainSlopeAngle = Math.atan2(1.8, 6.0)
  const placeFlushWindow = (w, h, d, x, z, rotY = 0) => {
    const nz = z / 9.0
    let halfWidth = THREE.MathUtils.lerp(4.25, 1.2, (z + 3) / 9)
    halfWidth *= (1.0 - Math.pow(Math.abs(nz), 4) * 0.05)

    const nx = Math.min(Math.abs(x) / halfWidth, 1.0)
    const centerY = THREE.MathUtils.lerp(2.2, 0.4, (z - 1) / 6)
    const edgeThinness = Math.pow(nx, 1.5)
    const edgeHeight = THREE.MathUtils.lerp(0.8, 0.1, (z + 9) / 18)
    const finalY = THREE.MathUtils.lerp(centerY, edgeHeight, edgeThinness)

    const nx2 = Math.min((Math.abs(x) + 0.1) / halfWidth, 1.0)
    const finalY2 = THREE.MathUtils.lerp(centerY, edgeHeight, Math.pow(nx2, 1.5))
    const rotZ = Math.atan2(finalY2 - finalY, 0.1) * Math.sign(-x)

    const pane = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matGlass)
    pane.position.set(x, finalY - h / 2 + 0.02, z)
    pane.rotation.set(mainSlopeAngle, rotY, rotZ)
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
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 1.0), matGlass)
    pane.position.set(x, 1.95, z)
    pane.rotation.set(roofAngle, 0, x > 0 ? -0.1 : 0.1)
    ship.add(pane)
  }
  placeRoofWindow(-0.7, 0.2)
  placeRoofWindow(0.7, 0.2)

  // Re-center pivot to visual mass center so spin is pure self-rotation.
  ship.updateMatrixWorld(true)
  const center = new THREE.Box3().setFromObject(ship).getCenter(new THREE.Vector3())
  for (const child of ship.children) {
    child.position.sub(center)
  }

  // Small negative depth bias prevents occasional false overdraw by nearby geometry.
  applyDepthBias(ship, -1, -2)

  return ship
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
    let enduranceShip = null
    let rangerShip = null
    let enduranceDebris = null
    let sunLight = null
    let fillLight = null
    let movementKeyBlockHandler = null
    let cameraLockedPosition = null

    let savedCameraNear = 0
    let savedCameraFar = 0
    let savedCameraFov = 0
    let savedBackground = null

    const animationState = {
      ready: false,
      time: 0,
      enduranceSpinAngle: 0,
      rangerSpinAngle: 0,
      currentEnduranceSpinRate: ENDURANCE_SPIN_RATE,
      baseEndurancePosition: new THREE.Vector3(),
      baseEnduranceQuaternion: new THREE.Quaternion(),
      rangerInitialPosition: new THREE.Vector3(),
      approachStarted: false,
      dockPortWorld: new THREE.Vector3(),
      dockAxisWorld: new THREE.Vector3(),
      rangerStartParallel: 0,
      rangerStartRadial: 0,
      rangerStartRadialDir: new THREE.Vector3(1, 0, 0),
      rangerVelocity: new THREE.Vector3(),
      rangerTargetPosition: new THREE.Vector3(),
    }

    function positionCamera(camera) {
      camera.position.set(6878.606, 4914.173, 6141.678)
      camera.lookAt(6301.714, 4779.175, 5336.091)
    }

    function updateAtmosphereCenterUniform() {
      if (!planetSystem) {
        return
      }

      planetSystem.group.getWorldPosition(TMP_VEC3_A)
      planetSystem.atmosphereCenterWorld.value.copy(TMP_VEC3_A)
    }

    function updateDockingFrameFromEndurance() {
      if (!enduranceShip) {
        return
      }

      animationState.dockAxisWorld.copy(LOCAL_FORWARD_Z).applyQuaternion(enduranceShip.quaternion).normalize()
      animationState.dockPortWorld.copy(ENDURANCE_DOCK_PORT_LOCAL).applyQuaternion(enduranceShip.quaternion)
      animationState.dockPortWorld.add(enduranceShip.position)
    }

    function positionShipsInSceneFrame() {
      if (!enduranceShip || !rangerShip) {
        return
      }

      TMP_VEC3_B.copy(SHIP_STAGING_CAMERA_LOOK_AT).sub(SHIP_STAGING_CAMERA_POSITION).normalize()
      TMP_VEC3_C.crossVectors(TMP_VEC3_B, UP_VECTOR).normalize()
      TMP_VEC3_D.crossVectors(TMP_VEC3_C, TMP_VEC3_B).normalize()

      TMP_VEC3_E.copy(SHIP_STAGING_CAMERA_POSITION).addScaledVector(TMP_VEC3_B, SHIP_CAMERA_DISTANCE)

      enduranceShip.position.copy(TMP_VEC3_E)
      enduranceShip.position.addScaledVector(TMP_VEC3_C, ENDURANCE_OFFSET_RIGHT)
      enduranceShip.position.addScaledVector(TMP_VEC3_D, ENDURANCE_OFFSET_UP)
      enduranceShip.rotation.set(-0.5, -0.3, 0.84)

      rangerShip.position.copy(TMP_VEC3_E)
      rangerShip.position.addScaledVector(TMP_VEC3_C, RANGER_OFFSET_RIGHT)
      rangerShip.position.addScaledVector(TMP_VEC3_D, RANGER_OFFSET_UP)
      rangerShip.position.addScaledVector(TMP_VEC3_B, RANGER_OFFSET_FORWARD)
      rangerShip.scale.setScalar(1.35)
    }

    function initializeShipAnimationState() {
      if (!enduranceShip || !rangerShip) {
        return
      }

      animationState.time = 0
      animationState.enduranceSpinAngle = 0
      animationState.rangerSpinAngle = 0
      animationState.currentEnduranceSpinRate = ENDURANCE_SPIN_RATE
      animationState.approachStarted = false
      animationState.baseEndurancePosition.copy(enduranceShip.position)
      animationState.baseEnduranceQuaternion.copy(enduranceShip.quaternion)
      animationState.rangerInitialPosition.copy(rangerShip.position)
      animationState.rangerVelocity.set(0, 0, 0)

      updateDockingFrameFromEndurance()
      TMP_QUAT_B.setFromUnitVectors(UP_VECTOR, TMP_VEC3_E.copy(animationState.dockAxisWorld).negate())
      rangerShip.quaternion.copy(TMP_QUAT_B)

      animationState.rangerTargetPosition.copy(rangerShip.position)

      animationState.ready = true
    }

    function configureDebrisPieceCycle(piece, cycleStartTime) {
      const damageAngle = ENDURANCE_DEBRIS_SOURCE_ANGLE + THREE.MathUtils.randFloatSpread(ENDURANCE_DEBRIS_ANGLE_SPREAD)
      const radialDistance = THREE.MathUtils.randFloat(ENDURANCE_DEBRIS_RADIUS_MIN, ENDURANCE_DEBRIS_RADIUS_MAX)
      const localZ = THREE.MathUtils.randFloat(ENDURANCE_DEBRIS_Z_MIN, ENDURANCE_DEBRIS_Z_MAX)

      piece.localAnchor.set(
        Math.cos(damageAngle) * radialDistance,
        Math.sin(damageAngle) * radialDistance,
        localZ,
      )

      piece.localOutward.set(
        Math.cos(damageAngle),
        Math.sin(damageAngle),
        THREE.MathUtils.randFloatSpread(0.14),
      ).normalize()

      piece.localTangent.crossVectors(LOCAL_FORWARD_Z, piece.localOutward)
      if (piece.localTangent.lengthSq() < 1e-6) {
        piece.localTangent.set(1, 0, 0)
      } else {
        piece.localTangent.normalize()
      }

      piece.localBaseQuaternion.setFromEuler(new THREE.Euler(
        THREE.MathUtils.randFloatSpread(1.15),
        THREE.MathUtils.randFloatSpread(1.15),
        THREE.MathUtils.randFloatSpread(1.15),
      ))

      piece.peelStartTime = cycleStartTime + THREE.MathUtils.randFloat(
        ENDURANCE_DEBRIS_PEEL_DELAY_MIN,
        ENDURANCE_DEBRIS_PEEL_DELAY_MAX,
      )
      piece.detachTime = piece.peelStartTime + THREE.MathUtils.randFloat(
        ENDURANCE_DEBRIS_PEEL_DURATION_MIN,
        ENDURANCE_DEBRIS_PEEL_DURATION_MAX,
      )
      piece.maxPeelDistance = THREE.MathUtils.randFloat(
        ENDURANCE_DEBRIS_PEEL_DISTANCE_MIN,
        ENDURANCE_DEBRIS_PEEL_DISTANCE_MAX,
      )
      piece.peelTwist = THREE.MathUtils.randFloatSpread(1.25)
      piece.outwardSpeed = THREE.MathUtils.randFloat(
        ENDURANCE_DEBRIS_OUTWARD_SPEED_MIN,
        ENDURANCE_DEBRIS_OUTWARD_SPEED_MAX,
      )
      piece.axialSpeed = THREE.MathUtils.randFloatSpread(ENDURANCE_DEBRIS_AXIAL_SPEED_MAX)
      piece.spinCarry = THREE.MathUtils.randFloat(0.28, 0.82)
      piece.rollRate = THREE.MathUtils.randFloatSpread(2.3)
      piece.tumbleRate = THREE.MathUtils.randFloatSpread(1.7)
      piece.lifetime = THREE.MathUtils.randFloat(
        ENDURANCE_DEBRIS_LIFETIME_MIN,
        ENDURANCE_DEBRIS_LIFETIME_MAX,
      )
      piece.released = false
      piece.releasedAge = 0
      piece.velocity.set(0, 0, 0)
      piece.angularVelocity.set(0, 0, 0)
    }

    function initializeEnduranceDebrisSimulation() {
      if (!enduranceDebris) {
        return
      }

      for (const piece of enduranceDebris.pieces) {
        const cycleOffset = -THREE.MathUtils.randFloat(0, 4.5)
        configureDebrisPieceCycle(piece, cycleOffset)
      }
    }

    function updateEnduranceDebrisSimulation(delta) {
      if (!animationState.ready || !enduranceShip || !enduranceDebris) {
        return
      }

      TMP_VEC3_H.copy(LOCAL_FORWARD_Z).applyQuaternion(enduranceShip.quaternion).normalize()
      TMP_VEC3_I.copy(TMP_VEC3_H).multiplyScalar(animationState.currentEnduranceSpinRate)

      for (const piece of enduranceDebris.pieces) {
        if (!piece.released) {
          const peelT = smoothstepRange(piece.peelStartTime, piece.detachTime, animationState.time)
          const peelDistance = piece.maxPeelDistance * peelT * peelT

          TMP_VEC3_J.copy(piece.localAnchor).addScaledVector(piece.localOutward, peelDistance)
          TMP_VEC3_K.copy(TMP_VEC3_J).applyQuaternion(enduranceShip.quaternion)
          piece.mesh.position.copy(enduranceShip.position).add(TMP_VEC3_K)

          TMP_QUAT_D.copy(enduranceShip.quaternion).multiply(piece.localBaseQuaternion)
          TMP_QUAT_E.setFromAxisAngle(piece.localTangent, piece.peelTwist * peelT)
          piece.mesh.quaternion.copy(TMP_QUAT_D).multiply(TMP_QUAT_E)

          if (animationState.time >= piece.detachTime) {
            piece.released = true
            piece.releasedAge = 0

            TMP_VEC3_D.copy(TMP_VEC3_K)
            TMP_VEC3_E.crossVectors(TMP_VEC3_I, TMP_VEC3_D)
            TMP_VEC3_G.copy(piece.localOutward).applyQuaternion(enduranceShip.quaternion).normalize()

            piece.velocity.copy(TMP_VEC3_E)
            piece.velocity.addScaledVector(TMP_VEC3_G, piece.outwardSpeed)
            piece.velocity.addScaledVector(TMP_VEC3_H, piece.axialSpeed)
            if (piece.velocity.length() > ENDURANCE_DEBRIS_MAX_SPEED) {
              piece.velocity.setLength(ENDURANCE_DEBRIS_MAX_SPEED)
            }

            piece.angularVelocity.copy(TMP_VEC3_H).multiplyScalar(animationState.currentEnduranceSpinRate * piece.spinCarry)
            piece.angularVelocity.addScaledVector(TMP_VEC3_G, piece.rollRate)
            if (piece.velocity.lengthSq() > 1e-6) {
              TMP_VEC3_A.copy(piece.velocity).normalize()
              piece.angularVelocity.addScaledVector(TMP_VEC3_A, piece.tumbleRate)
            }
          }
        } else {
          piece.releasedAge += delta
          piece.mesh.position.addScaledVector(piece.velocity, delta)

          const angularSpeed = piece.angularVelocity.length()
          if (angularSpeed > 1e-6) {
            TMP_VEC3_B.copy(piece.angularVelocity).multiplyScalar(1 / angularSpeed)
            TMP_QUAT_D.setFromAxisAngle(TMP_VEC3_B, angularSpeed * delta)
            piece.mesh.quaternion.premultiply(TMP_QUAT_D).normalize()
          }

          if (piece.releasedAge >= piece.lifetime) {
            const respawnDelay = THREE.MathUtils.randFloat(
              ENDURANCE_DEBRIS_RESPAWN_DELAY_MIN,
              ENDURANCE_DEBRIS_RESPAWN_DELAY_MAX,
            )
            configureDebrisPieceCycle(piece, animationState.time + respawnDelay)
          }
        }
      }
    }

    function animateShipDockingSequence(delta) {
      if (!animationState.ready || !enduranceShip || !rangerShip) {
        return
      }

      animationState.time += delta

      const approachEnd = RANGER_APPROACH_START + RANGER_APPROACH_DURATION
      const dockEnd = approachEnd + RANGER_DOCK_SETTLE_DURATION
      const spinDownEnd = dockEnd + RANGER_POST_DOCK_SPINDOWN_DURATION

      const spinUpT = smoothstepRange(0, RANGER_SPIN_UP_DURATION, animationState.time)
      const rawApproachT = smoothstepRange(RANGER_APPROACH_START, approachEnd, animationState.time)
      const rawDockT = smoothstepRange(approachEnd, dockEnd, animationState.time)
      const spinDownT = smoothstepRange(dockEnd, spinDownEnd, animationState.time)

      animationState.currentEnduranceSpinRate = THREE.MathUtils.lerp(ENDURANCE_SPIN_RATE, 0, spinDownT)
      animationState.enduranceSpinAngle += animationState.currentEnduranceSpinRate * delta
      TMP_QUAT_A.setFromAxisAngle(LOCAL_FORWARD_Z, animationState.enduranceSpinAngle)
      enduranceShip.quaternion.copy(animationState.baseEnduranceQuaternion).multiply(TMP_QUAT_A)
      enduranceShip.position.copy(animationState.baseEndurancePosition)

      updateDockingFrameFromEndurance()

      const rangerSpinRate = THREE.MathUtils.lerp(0, animationState.currentEnduranceSpinRate, spinUpT)
      animationState.rangerSpinAngle += rangerSpinRate * delta

      if (!animationState.approachStarted && animationState.time >= RANGER_APPROACH_START) {
        animationState.approachStarted = true

        TMP_VEC3_A.copy(rangerShip.position).sub(animationState.dockPortWorld)
        animationState.rangerStartParallel = TMP_VEC3_A.dot(animationState.dockAxisWorld)

        TMP_VEC3_B.copy(animationState.dockAxisWorld).multiplyScalar(animationState.rangerStartParallel)
        TMP_VEC3_C.copy(TMP_VEC3_A).sub(TMP_VEC3_B)
        animationState.rangerStartRadial = TMP_VEC3_C.length()

        if (animationState.rangerStartRadial > 1e-4) {
          animationState.rangerStartRadialDir.copy(TMP_VEC3_C).normalize()
        } else {
          animationState.rangerStartRadialDir.set(1, 0, 0)
        }
      }

      const approachT = animationState.approachStarted ? rawApproachT : 0
      const dockT = animationState.approachStarted ? rawDockT : 0

      if (!animationState.approachStarted) {
        animationState.rangerTargetPosition.copy(animationState.rangerInitialPosition)
      } else {
        TMP_VEC3_D.copy(animationState.rangerStartRadialDir)

        const parallelApproach = THREE.MathUtils.lerp(animationState.rangerStartParallel, RANGER_DOCK_CLEARANCE, approachT)
        const parallelOffset = THREE.MathUtils.lerp(parallelApproach, RANGER_DOCK_CLEARANCE, dockT)
        const radialApproach = THREE.MathUtils.lerp(animationState.rangerStartRadial, RANGER_DOCK_RADIAL_OFFSET, approachT)
        let radialOffset = THREE.MathUtils.lerp(radialApproach, 0, dockT)
        radialOffset = THREE.MathUtils.lerp(radialOffset, 0, spinDownT)

        animationState.rangerTargetPosition.copy(animationState.dockPortWorld)
        animationState.rangerTargetPosition.addScaledVector(animationState.dockAxisWorld, parallelOffset)
        animationState.rangerTargetPosition.addScaledVector(TMP_VEC3_D, radialOffset)
      }

      if (!animationState.approachStarted) {
        rangerShip.position.copy(animationState.rangerInitialPosition)
        animationState.rangerVelocity.set(0, 0, 0)
      } else {
        const springStiffness = THREE.MathUtils.lerp(5.0, 9.8, dockT)
        const springDamping = THREE.MathUtils.lerp(4.6, 7.4, dockT)
        integrateSpringVector(
          rangerShip.position,
          animationState.rangerVelocity,
          animationState.rangerTargetPosition,
          delta,
          springStiffness,
          springDamping,
        )
      }

      TMP_QUAT_B.setFromUnitVectors(UP_VECTOR, TMP_VEC3_E.copy(animationState.dockAxisWorld).negate())
      TMP_QUAT_C.setFromAxisAngle(animationState.dockAxisWorld, animationState.rangerSpinAngle)
      rangerShip.quaternion.copy(TMP_QUAT_C).multiply(TMP_QUAT_B)

      if (dockT > 0.995) {
        rangerShip.position.lerp(animationState.rangerTargetPosition, THREE.MathUtils.clamp(delta * 6, 0, 1))
      }

      if (spinDownT > 0.995) {
        rangerShip.position.copy(animationState.rangerTargetPosition)
        animationState.rangerVelocity.set(0, 0, 0)
      }
    }

    return {
      init({ camera, renderer, root, scene }) {
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
        cameraLockedPosition = camera.position.clone()

        movementKeyBlockHandler = (event) => {
          if (!MOVEMENT_KEY_CODES.has(event.code)) {
            return
          }

          if (document.pointerLockElement === renderer?.domElement) {
            event.preventDefault()
            event.stopPropagation()
            if (typeof event.stopImmediatePropagation === 'function') {
              event.stopImmediatePropagation()
            }
          }
        }
        window.addEventListener('keydown', movementKeyBlockHandler, true)
        window.addEventListener('keyup', movementKeyBlockHandler, true)

        enduranceShip = createDamagedEndurance()
        rangerShip = createRangerShipWithoutLandingLegs()
        enduranceDebris = createEndurancePeelingDebris(enduranceShip.userData?.hullMaterial)
        sceneGroup.add(enduranceShip, rangerShip, enduranceDebris.group)
        positionShipsInSceneFrame()
        initializeShipAnimationState()
        initializeEnduranceDebrisSimulation()
        updateEnduranceDebrisSimulation(0)
      },

      update({ camera, delta }) {
        if (!planetSystem || !stars || !enduranceShip || !rangerShip) {
          return
        }

        if (cameraLockedPosition) {
          camera.position.copy(cameraLockedPosition)
        }

        updateAtmosphereCenterUniform()
        animateShipDockingSequence(delta)
        updateEnduranceDebrisSimulation(delta)

        stars.position.copy(camera.position)
      },

      resize() {},

      dispose({ camera, scene }) {
        if (movementKeyBlockHandler) {
          window.removeEventListener('keydown', movementKeyBlockHandler, true)
          window.removeEventListener('keyup', movementKeyBlockHandler, true)
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
        planetSystem = null
        enduranceShip = null
        rangerShip = null
        enduranceDebris = null
        animationState.ready = false
        sunLight = null
        fillLight = null
        cameraLockedPosition = null
        rootRef = null
      },
    }
  },
}
