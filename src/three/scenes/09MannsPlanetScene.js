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
    size: [1.25, 1.55, 0.75],
    position: [0, 2.1, 0],
    color: suitMain,
  })

  addBlockPart(figure, {
    name: `${name}-chest-plate`,
    size: [1.05, 0.85, 0.2],
    position: [0, 2.2, 0.48],
    color: suitPanel,
    roughness: 0.66,
    metalness: 0.24,
  })

  addBlockPart(figure, {
    name: `${name}-backpack`,
    size: [0.95, 1, 0.4],
    position: [0, 2.1, -0.57],
    color: suitPanel,
    roughness: 0.64,
    metalness: 0.26,
  })

  addBlockPart(figure, {
    name: `${name}-accent-collar`,
    size: [0.55, 0.18, 0.25],
    position: [0, 2.8, 0.45],
    color: accentColor,
  })

  addBlockPart(figure, {
    name: `${name}-accent-stripe`,
    size: [0.2, 0.7, 0.08],
    position: [0.3, 2.2, 0.58],
    color: accentColor,
  })

  addBlockPart(figure, {
    name: `${name}-left-shoulder`,
    size: [0.42, 0.2, 0.44],
    position: [-0.86, 2.75, 0],
    color: accentColor,
  })

  addBlockPart(figure, {
    name: `${name}-right-shoulder`,
    size: [0.42, 0.2, 0.44],
    position: [0.86, 2.75, 0],
    color: accentColor,
  })

  const head = addBlockPart(figure, {
    name: `${name}-helmet`,
    size: [0.86, 0.86, 0.86],
    position: [0, 3.4, 0],
    color: suitMain,
    roughness: 0.62,
    metalness: 0.3,
  })

  addBlockPart(figure, {
    name: `${name}-visor`,
    size: [0.62, 0.24, 0.18],
    position: [0, 3.35, 0.5],
    color: visorDark,
    roughness: 0.28,
    metalness: 0.08,
  })

  const leftArm = addBlockPart(figure, {
    name: `${name}-left-arm`,
    size: [0.38, 1.25, 0.38],
    position: [-0.86, 2.15, 0],
    color: suitMain,
  })

  const rightArm = addBlockPart(figure, {
    name: `${name}-right-arm`,
    size: [0.38, 1.25, 0.38],
    position: [0.86, 2.15, 0],
    color: suitMain,
  })

  const leftForearm = addBlockPart(figure, {
    name: `${name}-left-forearm`,
    size: [0.34, 0.82, 0.34],
    position: [-0.86, 1.45, 0.08],
    color: suitPanel,
  })

  const rightForearm = addBlockPart(figure, {
    name: `${name}-right-forearm`,
    size: [0.34, 0.82, 0.34],
    position: [0.86, 1.45, 0.08],
    color: suitPanel,
  })

  addBlockPart(figure, {
    name: `${name}-left-glove`,
    size: [0.34, 0.3, 0.42],
    position: [-0.86, 0.98, 0.17],
    color: gloveColor,
  })

  addBlockPart(figure, {
    name: `${name}-right-glove`,
    size: [0.34, 0.3, 0.42],
    position: [0.86, 0.98, 0.17],
    color: gloveColor,
  })

  const leftLeg = addBlockPart(figure, {
    name: `${name}-left-leg`,
    size: [0.43, 1.15, 0.43],
    position: [-0.3, 0.85, 0],
    color: suitMain,
  })

  const rightLeg = addBlockPart(figure, {
    name: `${name}-right-leg`,
    size: [0.43, 1.15, 0.43],
    position: [0.3, 0.85, 0],
    color: suitMain,
  })

  addBlockPart(figure, {
    name: `${name}-left-boot`,
    size: [0.47, 0.3, 0.66],
    position: [-0.3, 0.16, 0.1],
    color: bootColor,
  })

  addBlockPart(figure, {
    name: `${name}-right-boot`,
    size: [0.47, 0.3, 0.66],
    position: [0.3, 0.16, 0.1],
    color: bootColor,
  })

  torso.rotation.z = -0.1
  head.rotation.y = 0.3
  leftArm.rotation.z = 0.45
  rightArm.rotation.z = -0.25
  rightArm.rotation.x = -0.2
  leftForearm.rotation.z = -0.65
  rightForearm.rotation.z = -0.05
  rightForearm.rotation.x = -0.55
  leftLeg.rotation.x = -0.08
  rightLeg.rotation.x = 0.22

  return figure
}

function createFallenAstronaut({ name }) {
  const figure = new THREE.Group()
  figure.name = name
  figure.position.y = -0.55
  figure.rotation.set(0.05, 0, -0.18)

  const suitMain = '#d7dde2'
  const suitPanel = '#a3acb4'
  const suitDark = '#4f5a64'
  const visorDark = '#111922'
  const gloveColor = '#66727d'
  const bootColor = '#5b6670'

  addBlockPart(figure, {
    name: `${name}-torso`,
    size: [1.6, 0.9, 0.78],
    position: [0, 0.95, 0],
    color: suitMain,
  })

  addBlockPart(figure, {
    name: `${name}-chest-plate`,
    size: [1.05, 0.6, 0.2],
    position: [0, 1.2, 0.4],
    color: suitPanel,
    roughness: 0.66,
    metalness: 0.24,
  })

  addBlockPart(figure, {
    name: `${name}-backpack`,
    size: [1.2, 0.7, 0.32],
    position: [-0.05, 0.68, -0.5],
    color: suitPanel,
    roughness: 0.64,
    metalness: 0.26,
  })

  addBlockPart(figure, {
    name: `${name}-helmet`,
    size: [0.84, 0.84, 0.84],
    position: [-1.15, 1.1, 0.02],
    color: suitMain,
    roughness: 0.62,
    metalness: 0.3,
  })

  addBlockPart(figure, {
    name: `${name}-visor`,
    size: [0.6, 0.22, 0.18],
    position: [-1.15, 1.08, 0.48],
    color: visorDark,
    roughness: 0.28,
    metalness: 0.08,
  })

  addBlockPart(figure, {
    name: `${name}-left-arm`,
    size: [0.42, 0.95, 0.42],
    position: [-0.2, 1, 0.95],
    rotation: [0.15, 0.2, 1.1],
    color: suitMain,
  })

  addBlockPart(figure, {
    name: `${name}-right-arm`,
    size: [0.42, 0.95, 0.42],
    position: [0.6, 0.95, -0.9],
    rotation: [0.1, -0.2, -1.05],
    color: suitMain,
  })

  addBlockPart(figure, {
    name: `${name}-left-glove`,
    size: [0.36, 0.3, 0.4],
    position: [-0.52, 1.36, 1.05],
    color: gloveColor,
  })

  addBlockPart(figure, {
    name: `${name}-right-glove`,
    size: [0.36, 0.3, 0.4],
    position: [0.95, 1.22, -0.98],
    color: gloveColor,
  })

  addBlockPart(figure, {
    name: `${name}-left-leg`,
    size: [0.95, 0.42, 0.42],
    position: [1.1, 0.82, 0.24],
    rotation: [0.15, 0.08, 0.18],
    color: suitDark,
  })

  addBlockPart(figure, {
    name: `${name}-right-leg`,
    size: [0.95, 0.42, 0.42],
    position: [1.1, 0.82, -0.24],
    rotation: [0.02, -0.08, 0.08],
    color: suitDark,
  })

  addBlockPart(figure, {
    name: `${name}-left-boot`,
    size: [0.56, 0.42, 0.46],
    position: [1.75, 0.78, 0.24],
    rotation: [0.08, 0.2, 0.05],
    color: bootColor,
  })

  addBlockPart(figure, {
    name: `${name}-right-boot`,
    size: [0.56, 0.42, 0.46],
    position: [1.75, 0.78, -0.24],
    rotation: [0.02, -0.1, -0.04],
    color: bootColor,
  })

  return figure
}

function createFightCharacters(camera) {
  const fightGroup = new THREE.Group()
  fightGroup.name = 'manns-planet-fight-characters'

  const forward = new THREE.Vector3()
  camera.getWorldDirection(forward)
  forward.normalize()

  const right = new THREE.Vector3().crossVectors(forward, UP_AXIS).normalize()

  const fightCenter = camera.position.clone().addScaledVector(forward, 18)
  fightCenter.y -= 17

  const mann = createStandingAstronaut({
    name: 'dr-mann-blocky',
    accentColor: '#cc6f42',
  })

  mann.position.copy(fightCenter)
  mann.position.addScaledVector(right, -1.9)
  mann.position.addScaledVector(forward, 0.8)

  const cooper = createFallenAstronaut({
    name: 'cooper-blocky',
  })

  cooper.position.copy(fightCenter)
  cooper.position.addScaledVector(right, 1.35)
  cooper.position.addScaledVector(forward, -1.05)
  cooper.rotation.y = Math.atan2(forward.x, forward.z) - Math.PI * 0.25

  mann.lookAt(cooper.position.x, mann.position.y + 1.7, cooper.position.z)

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

        const fightCharacters = createFightCharacters(camera)
        group.add(fightCharacters)

        camera.fov = 45
        camera.near = 0.1
        camera.far = 15000
        camera.position.set(506.728, -5.863, -342.568)
        camera.lookAt(1379.031, -192.585, -794.478)
        camera.updateProjectionMatrix()
      },

      update() {},

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
