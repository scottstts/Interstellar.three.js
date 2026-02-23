import * as THREE from 'three/webgpu'
import {
  abs,
  color,
  dot,
  float,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl'
import { disposeObject3D } from '../utils/dispose'

function createTerrainMaterial() {
  const material = new THREE.MeshStandardNodeMaterial()
  const posXZ = positionLocal.xz

  const getElevation = (p) => {
    let h = float(0.0)
    h = h.add(mx_noise_float(vec3(p.x.mul(0.0004), float(0.0), p.y.mul(0.0004))).mul(350.0))

    const n2 = mx_noise_float(vec3(p.x.mul(0.002), float(100.0), p.y.mul(0.002)))
    const ridge = float(1.0).sub(abs(n2))
    h = h.add(ridge.mul(ridge).mul(150.0))

    h = h.add(mx_noise_float(vec3(p.x.mul(0.01), float(200.0), p.y.mul(0.01))).mul(25.0))
    return h
  }

  const rawElevation = getElevation(posXZ)
  const centerElevation = getElevation(vec2(0.0, 0.0))
  const finalElevation = rawElevation.sub(centerElevation)
  material.positionNode = positionLocal.add(vec3(0, finalElevation, 0))

  const delta = float(0.5)
  const hL = getElevation(posXZ.add(vec2(delta.negate(), float(0.0))))
  const hR = getElevation(posXZ.add(vec2(delta, float(0.0))))
  const hD = getElevation(posXZ.add(vec2(float(0.0), delta.negate())))
  const hU = getElevation(posXZ.add(vec2(float(0.0), delta)))

  const dx = hR.sub(hL).div(delta.mul(2.0))
  const dz = hU.sub(hD).div(delta.mul(2.0))
  const macroNormal = normalize(vec3(dx.negate(), float(1.0), dz.negate()))

  const slope = dot(macroNormal, vec3(0.0, 1.0, 0.0))
  const slopeNoise = mx_noise_float(vec3(posXZ.x.mul(0.01), float(5.0), posXZ.y.mul(0.01))).mul(0.1)
  const rockMask = smoothstep(float(0.75), float(0.65), slope.add(slopeNoise))

  const windScourNoise = mx_noise_float(vec3(posXZ.x.mul(0.003), float(10.0), posXZ.y.mul(0.001)))
  const scourMask = smoothstep(float(-0.2), float(0.3), windScourNoise)

  const gritNoise = mx_noise_float(vec3(posXZ.x.mul(0.08), float(20.0), posXZ.y.mul(0.08)))
  const gritMask = smoothstep(float(0.3), float(0.7), gritNoise)

  const colorSnow = color('#e6ecf0')
  const roughSnow = float(0.9)
  const bumpSnowX = mx_noise_float(vec3(posXZ.x.mul(0.8), float(30.0), posXZ.y.mul(0.8)))
  const bumpSnowZ = mx_noise_float(vec3(posXZ.x.mul(0.8), float(31.0), posXZ.y.mul(0.8)))
  const bumpSnow = vec3(bumpSnowX.mul(0.2), float(0.0), bumpSnowZ.mul(0.2))

  const colorIce = color('#9ca7b0')
  const roughIce = float(0.4)
  const bumpIceX = mx_noise_float(vec3(posXZ.x.mul(0.2), float(40.0), posXZ.y.mul(0.05)))
  const bumpIceZ = mx_noise_float(vec3(posXZ.x.mul(0.2), float(41.0), posXZ.y.mul(0.05)))
  const bumpIce = vec3(bumpIceX.mul(0.1), float(0.0), bumpIceZ.mul(0.1))

  const colorGrit = color('#3c4245')
  const roughGrit = float(0.95)
  const bumpGritX = mx_noise_float(vec3(posXZ.x.mul(0.4), float(50.0), posXZ.y.mul(0.4)))
  const bumpGritZ = mx_noise_float(vec3(posXZ.x.mul(0.4), float(51.0), posXZ.y.mul(0.4)))
  const bumpGrit = vec3(bumpGritX.mul(0.4), float(0.0), bumpGritZ.mul(0.4))

  const colorRock = color('#2a2d2f')
  const roughRock = float(0.85)
  const bumpRockX = mx_noise_float(vec3(posXZ.x.mul(0.1), float(60.0), posXZ.y.mul(0.1)))
  const bumpRockZ = mx_noise_float(vec3(posXZ.x.mul(0.1), float(61.0), posXZ.y.mul(0.1)))
  const bumpRock = vec3(bumpRockX.mul(0.6), float(0.0), bumpRockZ.mul(0.6))

  let groundColor = mix(colorSnow, colorIce, scourMask)
  let groundRough = mix(roughSnow, roughIce, scourMask)
  let groundBump = mix(bumpSnow, bumpIce, scourMask)

  groundColor = mix(groundColor, colorGrit, gritMask)
  groundRough = mix(groundRough, roughGrit, gritMask)
  groundBump = mix(groundBump, bumpGrit, gritMask)

  material.colorNode = mix(groundColor, colorRock, rockMask)
  material.roughnessNode = mix(groundRough, roughRock, rockMask)

  const finalBumpVector = mix(groundBump, bumpRock, rockMask)
  material.normalNode = normalize(macroNormal.add(finalBumpVector))
  material.metalnessNode = float(0.0)

  return material
}

const UP_AXIS = new THREE.Vector3(0, 1, 0)
const FIGHT_DISTANCE_AHEAD = 10
const FIGHT_SURFACE_OFFSET = 0.02
const FIGHT_CHARACTER_SCALE = 0.5
const CAMERA_SURFACE_CLEARANCE = 0.2
const FIGHT_REFERENCE_CAMERA_POSITION = new THREE.Vector3(506.728, -5.863, -342.568)
const FIGHT_REFERENCE_CAMERA_LOOK_AT = new THREE.Vector3(1379.031, -192.585, -794.478)

function alignObjectBottomToY(object3D, targetY) {
  object3D.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(object3D)

  if (!Number.isFinite(bounds.min.y)) {
    return
  }

  object3D.position.y += targetY - bounds.min.y
}

function rotl32(value, shift) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0
}

function bjfinal(a, b, c) {
  c = ((c ^ b) - rotl32(b, 14)) >>> 0
  a = ((a ^ c) - rotl32(c, 11)) >>> 0
  b = ((b ^ a) - rotl32(a, 25)) >>> 0
  c = ((c ^ b) - rotl32(b, 16)) >>> 0
  a = ((a ^ c) - rotl32(c, 4)) >>> 0
  b = ((b ^ a) - rotl32(a, 14)) >>> 0
  c = ((c ^ b) - rotl32(b, 24)) >>> 0
  return c >>> 0
}

function hashInt3(x, y, z) {
  const len = 3 >>> 0
  const seed = (0xdeadbeef + (len << 2) + 13) >>> 0
  const a = (seed + (x >>> 0)) >>> 0
  const b = (seed + (y >>> 0)) >>> 0
  const c = (seed + (z >>> 0)) >>> 0
  return bjfinal(a, b, c)
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function gradientFloat3(hash, x, y, z) {
  const h = hash & 15
  const u = h < 8 ? x : y
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z
  const uTerm = (h & 1) === 0 ? u : -u
  const vTerm = (h & 2) === 0 ? v : -v
  return uTerm + vTerm
}

function trilerp(v0, v1, v2, v3, v4, v5, v6, v7, s, t, r) {
  const s1 = 1 - s
  const t1 = 1 - t
  const r1 = 1 - r
  return (
    r1 * (t1 * (v0 * s1 + v1 * s) + t * (v2 * s1 + v3 * s)) +
    r * (t1 * (v4 * s1 + v5 * s) + t * (v6 * s1 + v7 * s))
  )
}

function mxPerlinNoise3(x, y, z) {
  const xFloor = Math.floor(x)
  const yFloor = Math.floor(y)
  const zFloor = Math.floor(z)

  const fx = x - xFloor
  const fy = y - yFloor
  const fz = z - zFloor

  const u = fade(fx)
  const v = fade(fy)
  const w = fade(fz)

  const n000 = gradientFloat3(hashInt3(xFloor, yFloor, zFloor), fx, fy, fz)
  const n100 = gradientFloat3(hashInt3(xFloor + 1, yFloor, zFloor), fx - 1, fy, fz)
  const n010 = gradientFloat3(hashInt3(xFloor, yFloor + 1, zFloor), fx, fy - 1, fz)
  const n110 = gradientFloat3(hashInt3(xFloor + 1, yFloor + 1, zFloor), fx - 1, fy - 1, fz)
  const n001 = gradientFloat3(hashInt3(xFloor, yFloor, zFloor + 1), fx, fy, fz - 1)
  const n101 = gradientFloat3(hashInt3(xFloor + 1, yFloor, zFloor + 1), fx - 1, fy, fz - 1)
  const n011 = gradientFloat3(hashInt3(xFloor, yFloor + 1, zFloor + 1), fx, fy - 1, fz - 1)
  const n111 = gradientFloat3(
    hashInt3(xFloor + 1, yFloor + 1, zFloor + 1),
    fx - 1,
    fy - 1,
    fz - 1,
  )

  return (
    0.982 *
    trilerp(n000, n100, n010, n110, n001, n101, n011, n111, u, v, w)
  )
}

function getRawTerrainElevation(x, z) {
  let h = 0
  h += mxPerlinNoise3(x * 0.0004, 0.0, z * 0.0004) * 350.0

  const n2 = mxPerlinNoise3(x * 0.002, 100.0, z * 0.002)
  const ridge = 1.0 - Math.abs(n2)
  h += ridge * ridge * 150.0

  h += mxPerlinNoise3(x * 0.01, 200.0, z * 0.01) * 25.0
  return h
}

const TERRAIN_CENTER_ELEVATION = getRawTerrainElevation(0, 0)

function getTerrainElevationAt(x, z) {
  return getRawTerrainElevation(x, z) - TERRAIN_CENTER_ELEVATION
}

function getTerrainNormalAt(x, z, delta = 0.5) {
  const hL = getTerrainElevationAt(x - delta, z)
  const hR = getTerrainElevationAt(x + delta, z)
  const hD = getTerrainElevationAt(x, z - delta)
  const hU = getTerrainElevationAt(x, z + delta)

  const dx = (hR - hL) / (delta * 2)
  const dz = (hU - hD) / (delta * 2)

  return new THREE.Vector3(-dx, 1, -dz).normalize()
}

function addBlockPart(parent, config) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(config.size[0], config.size[1], config.size[2]),
    new THREE.MeshStandardMaterial({
      color: config.color,
      roughness: config.roughness ?? 0.78,
      metalness: config.metalness ?? 0.14,
    }),
  )

  mesh.position.set(config.position[0], config.position[1], config.position[2])

  if (config.rotation) {
    mesh.rotation.set(config.rotation[0], config.rotation[1], config.rotation[2])
  }

  if (config.name) {
    mesh.name = config.name
  }

  parent.add(mesh)
  return mesh
}

function createStandingAstronaut({ name, accentColor }) {
  const figure = new THREE.Group()
  figure.name = name

  const suitMain = '#dfe4e8'
  const suitPanel = '#9ba4ac'
  const visorDark = '#0f1822'
  const gloveColor = '#66727d'
  const bootColor = '#5b6670'

  const torso = addBlockPart(figure, {
    name: `${name}-torso`,
    size: [1.18, 1.6, 0.72],
    position: [0, 2.08, 0],
    color: suitMain,
  })

  addBlockPart(figure, {
    name: `${name}-chest-plate`,
    size: [0.96, 0.8, 0.18],
    position: [0, 2.18, 0.45],
    color: suitPanel,
    roughness: 0.66,
    metalness: 0.24,
  })

  addBlockPart(figure, {
    name: `${name}-backpack`,
    size: [0.86, 0.95, 0.34],
    position: [0, 2.08, -0.53],
    color: suitPanel,
    roughness: 0.64,
    metalness: 0.26,
  })

  addBlockPart(figure, {
    name: `${name}-accent-collar`,
    size: [0.52, 0.16, 0.22],
    position: [0, 2.78, 0.42],
    color: accentColor,
  })

  addBlockPart(figure, {
    name: `${name}-accent-stripe`,
    size: [0.16, 0.64, 0.07],
    position: [0.26, 2.18, 0.53],
    color: accentColor,
  })

  addBlockPart(figure, {
    name: `${name}-left-shoulder`,
    size: [0.4, 0.22, 0.4],
    position: [-0.78, 2.72, 0],
    color: accentColor,
  })

  addBlockPart(figure, {
    name: `${name}-right-shoulder`,
    size: [0.4, 0.22, 0.4],
    position: [0.78, 2.72, 0],
    color: accentColor,
  })

  const head = addBlockPart(figure, {
    name: `${name}-helmet`,
    size: [0.82, 0.82, 0.82],
    position: [0, 3.34, 0],
    color: suitMain,
    roughness: 0.62,
    metalness: 0.3,
  })

  addBlockPart(head, {
    name: `${name}-visor`,
    size: [0.58, 0.6, 0.16],
    position: [0, -0.02, 0.46],
    color: visorDark,
    roughness: 0.28,
    metalness: 0.08,
  })

  const leftArm = addBlockPart(figure, {
    name: `${name}-left-arm`,
    size: [0.34, 1.12, 0.34],
    position: [-0.78, 2.05, 0],
    color: suitMain,
  })

  const rightArm = addBlockPart(figure, {
    name: `${name}-right-arm`,
    size: [0.34, 1.12, 0.34],
    position: [0.78, 2.05, 0],
    color: suitMain,
  })

  const leftForearm = addBlockPart(figure, {
    name: `${name}-left-forearm`,
    size: [0.31, 0.74, 0.31],
    position: [-0.78, 1.34, 0.02],
    color: suitPanel,
  })

  const rightForearm = addBlockPart(figure, {
    name: `${name}-right-forearm`,
    size: [0.31, 0.74, 0.31],
    position: [0.78, 1.34, 0.02],
    color: suitPanel,
  })

  addBlockPart(figure, {
    name: `${name}-left-glove`,
    size: [0.31, 0.24, 0.36],
    position: [-0.78, 0.9, 0.08],
    color: gloveColor,
  })

  addBlockPart(figure, {
    name: `${name}-right-glove`,
    size: [0.31, 0.24, 0.36],
    position: [0.78, 0.9, 0.08],
    color: gloveColor,
  })

  const leftLeg = addBlockPart(figure, {
    name: `${name}-left-leg`,
    size: [0.4, 1.14, 0.4],
    position: [-0.24, 0.84, 0],
    color: suitMain,
  })

  const rightLeg = addBlockPart(figure, {
    name: `${name}-right-leg`,
    size: [0.4, 1.14, 0.4],
    position: [0.24, 0.84, 0],
    color: suitMain,
  })

  addBlockPart(figure, {
    name: `${name}-left-boot`,
    size: [0.44, 0.26, 0.58],
    position: [-0.24, 0.16, 0.08],
    color: bootColor,
  })

  addBlockPart(figure, {
    name: `${name}-right-boot`,
    size: [0.44, 0.26, 0.58],
    position: [0.24, 0.16, 0.08],
    color: bootColor,
  })

  torso.rotation.z = 0
  head.rotation.y = 0.16
  leftArm.rotation.z = 0.06
  rightArm.rotation.z = -0.06
  rightArm.rotation.x = -0.04
  leftForearm.rotation.z = -0.08
  rightForearm.rotation.z = 0.08
  rightForearm.rotation.x = -0.08
  leftLeg.rotation.x = 0
  rightLeg.rotation.x = 0

  return figure
}

function createFallenAstronaut({ name }) {
  const figure = createStandingAstronaut({
    name,
    accentColor: '#74808b',
  })

  return figure
}

function createFightCharacters({ anchorPosition, forward }) {
  const fightGroup = new THREE.Group()
  fightGroup.name = 'manns-planet-fight-characters'

  const right = new THREE.Vector3().crossVectors(forward, UP_AXIS).normalize()

  const fightCenter = anchorPosition.clone().addScaledVector(forward, FIGHT_DISTANCE_AHEAD)

  const mann = createStandingAstronaut({
    name: 'dr-mann-blocky',
    accentColor: '#cc6f42',
  })
  mann.scale.setScalar(FIGHT_CHARACTER_SCALE)

  const mannForwardOffset = 0.8

  mann.position.copy(fightCenter)
  mann.position.addScaledVector(right, -1.9)
  mann.position.addScaledVector(forward, mannForwardOffset)
  alignObjectBottomToY(
    mann,
    getTerrainElevationAt(mann.position.x, mann.position.z) + FIGHT_SURFACE_OFFSET,
  )

  const cooper = createFallenAstronaut({
    name: 'cooper-blocky',
  })
  cooper.scale.setScalar(FIGHT_CHARACTER_SCALE)

  const cooperForwardOffset = -1.05

  cooper.position.copy(fightCenter)
  cooper.position.addScaledVector(right, 1.35)
  cooper.position.addScaledVector(forward, cooperForwardOffset)

  const cooperSurfaceNormal = getTerrainNormalAt(cooper.position.x, cooper.position.z)

  const feetTowardMann = new THREE.Vector3(
    mann.position.x - cooper.position.x,
    0,
    mann.position.z - cooper.position.z,
  )

  if (feetTowardMann.lengthSq() < 0.00001) {
    feetTowardMann.copy(right)
  }
  feetTowardMann.normalize()

  const feetTangent = feetTowardMann.sub(
    cooperSurfaceNormal.clone().multiplyScalar(feetTowardMann.dot(cooperSurfaceNormal)),
  )

  if (feetTangent.lengthSq() < 0.00001) {
    feetTangent.copy(right)
  }
  feetTangent.normalize()

  const cooperHeadDirection = feetTangent.clone().negate()
  const cooperXAxis = new THREE.Vector3().crossVectors(cooperHeadDirection, cooperSurfaceNormal)

  if (cooperXAxis.lengthSq() < 0.00001) {
    cooperXAxis.set(1, 0, 0)
  }
  cooperXAxis.normalize()

  const cooperYAxis = new THREE.Vector3().crossVectors(cooperSurfaceNormal, cooperXAxis).normalize()
  const cooperBasis = new THREE.Matrix4().makeBasis(
    cooperXAxis,
    cooperYAxis,
    cooperSurfaceNormal,
  )
  cooper.quaternion.setFromRotationMatrix(cooperBasis)

  alignObjectBottomToY(
    cooper,
    getTerrainElevationAt(cooper.position.x, cooper.position.z) + FIGHT_SURFACE_OFFSET,
  )

  const mannToCooper = new THREE.Vector3().subVectors(cooper.position, mann.position)
  mannToCooper.y = 0
  if (mannToCooper.lengthSq() > 0.00001) {
    mann.rotation.y = Math.atan2(mannToCooper.x, mannToCooper.z)
  }
  mann.rotation.x = 0
  mann.rotation.z = 0

  fightGroup.add(mann)
  fightGroup.add(cooper)

  return fightGroup
}

export default {
  id: 'manns-planet',
  title: "Dr. Mann's Ice Planet",
  create() {
    let group = null
    let rootRef = null

    let previousBackground = null
    let previousFog = null
    let previousToneMapping = null
    let previousToneMappingExposure = null
    let previousFov = null
    let previousNear = null
    let previousFar = null

    const clampCameraToTerrain = (camera) => {
      const minY =
        getTerrainElevationAt(camera.position.x, camera.position.z) + CAMERA_SURFACE_CLEARANCE

      if (camera.position.y < minY) {
        camera.position.y = minY
        camera.updateMatrixWorld()
      }
    }

    return {
      init({ root, camera, renderer, scene }) {
        rootRef = root
        group = new THREE.Group()
        group.name = 'manns-planet-group'
        root.add(group)

        previousBackground = scene.background
        previousFog = scene.fog
        previousToneMapping = renderer.toneMapping
        previousToneMappingExposure = renderer.toneMappingExposure
        previousFov = camera.fov
        previousNear = camera.near
        previousFar = camera.far

        const fogColor = new THREE.Color('#d4cfcc')
        scene.background = fogColor
        scene.fog = new THREE.FogExp2(fogColor, 0.0018)

        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.1

        const ambientLight = new THREE.AmbientLight('#aab8c4', 0.8)
        group.add(ambientLight)

        const dirLight = new THREE.DirectionalLight('#fff0e0', 2.0)
        dirLight.position.set(800, 600, -1000)
        group.add(dirLight)

        const geometry = new THREE.PlaneGeometry(8000, 8000, 1024, 1024)
        geometry.rotateX(-Math.PI / 2)

        const material = createTerrainMaterial()
        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = 'manns-planet-terrain'
        group.add(mesh)

        camera.fov = 45
        camera.near = 0.1
        camera.far = 15000
        camera.position.set(522.722, -15.244, -342.701)
        camera.lookAt(-326.001, 93.416, -860.256)
        camera.updateProjectionMatrix()
        camera.updateMatrixWorld()
        clampCameraToTerrain(camera)

        const fightAnchorPosition = FIGHT_REFERENCE_CAMERA_POSITION.clone()
        const fightAnchorMinY =
          getTerrainElevationAt(fightAnchorPosition.x, fightAnchorPosition.z) + CAMERA_SURFACE_CLEARANCE
        if (fightAnchorPosition.y < fightAnchorMinY) {
          fightAnchorPosition.y = fightAnchorMinY
        }

        const fightForward = new THREE.Vector3()
          .subVectors(FIGHT_REFERENCE_CAMERA_LOOK_AT, FIGHT_REFERENCE_CAMERA_POSITION)
          .normalize()

        const fightCharacters = createFightCharacters({
          anchorPosition: fightAnchorPosition,
          forward: fightForward,
        })
        group.add(fightCharacters)
      },

      update({ camera }) {
        if (!camera) {
          return
        }

        clampCameraToTerrain(camera)
      },

      resize() {},

      dispose({ root, camera, renderer, scene }) {
        scene.background = previousBackground
        scene.fog = previousFog

        renderer.toneMapping = previousToneMapping
        renderer.toneMappingExposure = previousToneMappingExposure

        if (previousFov !== null && previousNear !== null && previousFar !== null) {
          camera.fov = previousFov
          camera.near = previousNear
          camera.far = previousFar
          camera.updateProjectionMatrix()
        }

        if (!group) {
          return
        }

        if (root && group.parent !== root && rootRef) {
          rootRef.add(group)
        }

        disposeObject3D(group)
        group = null
        rootRef = null
      },
    }
  },
}
