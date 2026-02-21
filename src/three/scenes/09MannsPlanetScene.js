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

        camera.fov = 45
        camera.near = 0.1
        camera.far = 15000
        camera.position.set(500, 20, -400)
        camera.lookAt(2500, -300, -800)
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
