import * as THREE from 'three/webgpu'
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  cameraPosition,
  color,
  cos,
  cross,
  dot,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  normalize,
  positionWorld,
  sin,
  smoothstep,
  sqrt,
  time,
  vec2,
  vec3,
} from 'three/tsl'
import { disposeObject3D } from '../utils/dispose'

const SHIP_RIG_SCALE = 0.07
const WORMHOLE_CENTER = new THREE.Vector3(0, 0, 0)

const MOVEMENT_KEY_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight'])

function createWormholeSky() {
  const hash = Fn(([pArg]) => {
    const p = vec3(pArg).toVar()
    const p3 = fract(p.mul(0.1031)).toVar()
    p3.addAssign(dot(p3, p3.zyx.add(31.32)))
    return fract(p3.x.add(p3.y).mul(p3.z))
  })

  const noise = Fn(([xArg]) => {
    const x = vec3(xArg).toVar()
    const p = floor(x).toVar()
    const fVal = fract(x).toVar()
    const u = fVal.mul(fVal).mul(float(3.0).sub(fVal.mul(2.0))).toVar()

    return mix(
      mix(
        mix(hash(p.add(vec3(0, 0, 0))), hash(p.add(vec3(1, 0, 0))), u.x),
        mix(hash(p.add(vec3(0, 1, 0))), hash(p.add(vec3(1, 1, 0))), u.x),
        u.y,
      ),
      mix(
        mix(hash(p.add(vec3(0, 0, 1))), hash(p.add(vec3(1, 0, 1))), u.x),
        mix(hash(p.add(vec3(0, 1, 1))), hash(p.add(vec3(1, 1, 1))), u.x),
        u.y,
      ),
      u.z,
    )
  })

  const fbm = Fn(([xArg]) => {
    const x = vec3(xArg).toVar()
    const v = float(0.0).toVar()
    const a = float(0.5).toVar()
    const p = vec3(x).toVar()

    Loop(5, () => {
      v.addAssign(a.mul(noise(p)))
      p.mulAssign(2.0)
      a.mulAssign(0.5)
    })

    return v
  })

  const getUniverse1 = Fn(([dArg]) => {
    const d = vec3(dArg).toVar()
    const drift = time.mul(0.055).toVar()
    const flowA = vec3(drift, drift.mul(0.36), drift.mul(-0.24)).toVar()
    const flowB = vec3(drift.mul(-0.17), drift.mul(0.43), drift.mul(0.31)).toVar()

    const warp = fbm(d.mul(2.4).add(vec3(13.1, -4.2, 7.7)).add(flowA)).sub(0.5).mul(0.34).toVar()
    const dWarped = normalize(vec3(d.x.add(warp), d.y.add(warp.mul(0.28)), d.z.sub(warp.mul(0.52)))).toVar()

    const broad = fbm(dWarped.mul(2.9)).toVar()
    const fine = fbm(dWarped.mul(6.2).add(vec3(7.0, 1.0, 11.0)).add(flowB)).toVar()
    const lane = float(1.0).sub(smoothstep(0.06, 0.78, abs(dWarped.y.add(fine.sub(0.5).mul(0.2)))))
    const smoke = smoothstep(0.28, 0.75, broad).mul(lane)
    const wisps = smoothstep(0.54, 0.88, fine).mul(lane).mul(0.42)

    const tint = mix(vec3(0.03, 0.06, 0.12), vec3(0.16, 0.27, 0.46), fine).toVar()
    return tint.mul(smoke.add(wisps))
  })

  const getUniverse2 = Fn(([dArg]) => {
    const d = vec3(dArg).toVar()
    const drift = time.mul(0.048).toVar()
    const flowA = vec3(drift.mul(-0.22), drift.mul(0.49), drift.mul(0.27)).toVar()
    const flowB = vec3(drift.mul(0.32), drift.mul(-0.18), drift.mul(0.44)).toVar()

    const tilt = vec3(d.x, d.y.mul(0.8).add(d.z.mul(0.6)), d.z.mul(0.8).sub(d.y.mul(0.6))).toVar()
    const warp = fbm(tilt.mul(2.0).add(vec3(2.0, 5.0, 8.0)).add(flowA)).sub(0.5).mul(0.3).toVar()
    const tiltedWarped = vec3(tilt.x.add(warp.mul(0.4)), tilt.y, tilt.z.sub(warp.mul(0.45))).toVar()

    const n = fbm(tiltedWarped.mul(2.8).add(vec3(1.0, 2.0, 3.0)).add(flowB)).toVar()
    const nFine = fbm(tiltedWarped.mul(6.0).add(vec3(9.0, 3.0, 1.0)).add(flowB.mul(1.6))).toVar()
    const disk = float(1.0).sub(smoothstep(0.0, 0.2, abs(tiltedWarped.y.add(nFine.sub(0.5).mul(0.12)))))
    const glow = float(1.0).sub(smoothstep(0.0, 0.9, abs(tiltedWarped.y)))

    const col = mix(vec3(0.09, 0.14, 0.28), vec3(0.32, 0.5, 0.78), n).toVar()
    col.mulAssign(disk.mul(1.45).add(glow.mul(0.22)))
    return col
  })

  const fDeriv = Fn(([yArg, bArg, RthArg]) => {
    const y = vec2(yArg).toVar()
    const b = float(bArg).toVar()
    const Rth = float(RthArg).toVar()

    const l = y.x.toVar()
    const pL = y.y.toVar()
    const r2 = l.mul(l).add(Rth.mul(Rth)).toVar()

    return vec2(r2.mul(pL), b.mul(b).mul(l).div(r2))
  })

  const wormholePhysics = Fn(([roArg, rdArg]) => {
    const ro = vec3(roArg).toVar()
    const rd = normalize(rdArg).toVar()

    const Rth = float(1.2)
    const maxDist = float(40.0)

    const rObs = length(ro).toVar()

    const l = sqrt(max(rObs.mul(rObs).sub(Rth.mul(Rth)), 0.001)).toVar()
    const pL = dot(normalize(ro), rd).toVar()

    const cro = cross(ro, rd).toVar()
    const b = length(cro).toVar()

    const n = vec3(0.0).toVar()
    If(b.lessThan(0.0001), () => {
      n.assign(normalize(cross(ro, vec3(0.0, 1.0, 0.0))))
      If(length(n).lessThan(0.0001), () => {
        n.assign(normalize(cross(ro, vec3(1.0, 0.0, 0.0))))
      })
    }).Else(() => {
      n.assign(normalize(cro))
    })

    const u = normalize(ro).toVar()
    const v = cross(n, u).toVar()

    const phi = float(0.0).toVar()
    const y = vec2(l, pL).toVar()
    const hStep = float(0.0042).add(hash(rd.mul(331.7)).sub(0.5).mul(0.0009)).toVar()

    const escaped = float(0.0).toVar()

    Loop(920, () => {
      const k1 = fDeriv(y, b, Rth).toVar()
      const k2 = fDeriv(y.add(k1.mul(hStep).mul(0.5)), b, Rth).toVar()
      const k3 = fDeriv(y.add(k2.mul(hStep).mul(0.5)), b, Rth).toVar()
      const k4 = fDeriv(y.add(k3.mul(hStep)), b, Rth).toVar()

      y.addAssign(k1.add(k2.mul(2.0)).add(k3.mul(2.0)).add(k4).mul(hStep.div(6.0)))
      phi.addAssign(hStep.mul(b))

      If(abs(y.x).greaterThan(maxDist), () => {
        escaped.assign(1.0)
        Break()
      })
    })

    const finalDir = normalize(u.mul(cos(phi)).add(v.mul(sin(phi)))).toVar()

    const outCol = vec3(0.0).toVar()

    If(escaped.equal(0.0), () => {
      outCol.assign(vec3(1.0, 0.8, 0.4).mul(2.0))
    }).ElseIf(y.x.lessThan(0.0), () => {
      outCol.assign(getUniverse2(finalDir))
    }).Else(() => {
      outCol.assign(getUniverse1(finalDir))
    })

    // Subtle grain to reduce visible banding in smooth gradients.
    const grain = hash(finalDir.mul(700.0)).sub(0.5).mul(0.01)
    outCol.addAssign(vec3(grain))

    return outCol
  })

  // Higher tessellation avoids visible polygon banding in the galaxy haze.
  const geometry = new THREE.SphereGeometry(500, 320, 320)
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
  })
  material.colorNode = wormholePhysics(cameraPosition, positionWorld.sub(cameraPosition).normalize())
  material.depthWrite = false

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'scene07-wormhole-sky'
  mesh.renderOrder = -100
  return mesh
}

function createStarField() {
  const starCount = 1400
  const positions = new Float32Array(starCount * 3)
  const colors = new Float32Array(starCount * 3)

  for (let index = 0; index < starCount; index += 1) {
    const u = Math.random() * 2 - 1
    const theta = Math.random() * Math.PI * 2
    const radius = THREE.MathUtils.lerp(230, 470, Math.pow(Math.random(), 0.6))
    const radial = Math.sqrt(1 - u * u)

    const x = radius * radial * Math.cos(theta)
    const y = radius * u
    const z = radius * radial * Math.sin(theta)

    positions[index * 3] = x
    positions[index * 3 + 1] = y
    positions[index * 3 + 2] = z

    const intensity = THREE.MathUtils.lerp(0.65, 1.0, Math.pow(Math.random(), 1.5))
    const warm = THREE.MathUtils.lerp(0.96, 1.0, Math.random())
    const cool = THREE.MathUtils.lerp(0.88, 0.99, Math.random())
    colors[index * 3] = intensity * warm
    colors[index * 3 + 1] = intensity * 0.97
    colors[index * 3 + 2] = intensity * cool
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const material = new THREE.PointsMaterial({
    size: 1.05,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
  })

  const points = new THREE.Points(geometry, material)
  points.name = 'scene07-starfield'
  points.renderOrder = -95
  return points
}

function createEndurance() {
  const endurance = new THREE.Group()
  endurance.name = 'scene07-endurance'

  function createMetalMat(hexColor, roughness, metalness) {
    const mat = new THREE.MeshStandardNodeMaterial()
    mat.colorNode = color(hexColor)
    mat.roughnessNode = float(roughness)
    mat.metalnessNode = float(metalness)
    return mat
  }

  const matWhiteHull = createMetalMat(0xdddddd, 0.4, 0.6)
  const matDarkHull = createMetalMat(0x333333, 0.5, 0.7)
  const matSolarPanel = createMetalMat(0x111111, 0.15, 0.9)
  const matGlossBlack = createMetalMat(0x050505, 0.05, 0.8)

  const materials = [matWhiteHull, matDarkHull, matSolarPanel, matGlossBlack]

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

    const jointAngle = angle + Math.PI / NUM_MODULES
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

  return { group: endurance, materials }
}

export default {
  id: 'wormhole-crossing',
  title: 'Wormhole Crossing Sequence',
  create() {
    let sceneGroup = null
    let shipRig = null
    let endurance = null

    let savedCameraNear = 0
    let savedCameraFar = 0
    let savedCameraFov = 0
    let savedBackground = null
    let cameraLockedPosition = null

    let movementKeyBlockHandler = null

    const state = {
      elapsed: 0,
      spinAngle: 0,
    }

    const flybyStart = new THREE.Vector3(-9.4, 1.25, 11.8)
    const flybyEnd = new THREE.Vector3(0, -25, -170)
    const flybyDirection = flybyEnd.clone().sub(flybyStart)

    function setShipTransform(progress01) {
      const tRaw = Math.max(progress01, 0)
      shipRig.position.copy(flybyStart).addScaledVector(flybyDirection, tRaw)

      const damp = Math.exp(-tRaw * 2.4)
      shipRig.position.x += Math.sin(tRaw * Math.PI * 1.2) * 0.2 * damp
      shipRig.position.y += Math.sin(tRaw * Math.PI * 0.9) * 0.1 * damp
    }

    return {
      init({ root, camera, renderer, scene }) {
        sceneGroup = new THREE.Group()
        sceneGroup.name = 'scene07-wormhole-crossing'

        sceneGroup.add(createWormholeSky())
        sceneGroup.add(createStarField())

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.42)
        ambientLight.name = 'scene07-ambient'
        sceneGroup.add(ambientLight)

        const sunLight = new THREE.DirectionalLight(0xffffff, 2.3)
        sunLight.name = 'scene07-sun'
        sunLight.position.set(7.5, 5.2, 8.5)
        sceneGroup.add(sunLight)

        endurance = createEndurance()

        shipRig = new THREE.Group()
        shipRig.name = 'scene07-ship-rig'
        shipRig.scale.setScalar(SHIP_RIG_SCALE)
        shipRig.add(endurance.group)
        sceneGroup.add(shipRig)

        root.add(sceneGroup)

        if (scene) {
          savedBackground = scene.background
          scene.background = new THREE.Color(0x000000)
        }

        if (camera) {
          savedCameraNear = camera.near
          savedCameraFar = camera.far
          savedCameraFov = camera.fov

          camera.near = 0.05
          camera.far = 1200
          camera.fov = 55
          camera.updateProjectionMatrix()

          camera.position.set(0, 1.8, 14)
          camera.lookAt(WORMHOLE_CENTER)
          cameraLockedPosition = camera.position.clone()
        }

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

        state.elapsed = 0
        state.spinAngle = 0
        setShipTransform(0)

        endurance.group.rotation.set(0.46, -0.12, 0.9)
      },

      update({ delta, camera }) {
        if (!shipRig || !endurance || !camera || !cameraLockedPosition) {
          return
        }

        // Disable WASD / vertical camera movement for this scene (mouse panning remains).
        camera.position.copy(cameraLockedPosition)

        const safeDelta = Math.min(Math.max(delta, 0), 0.05)
        state.elapsed += safeDelta

        const flybyDuration = 13
        const flybyProgress = state.elapsed / flybyDuration
        setShipTransform(flybyProgress)

        state.spinAngle += safeDelta * 0.78
        endurance.group.rotation.set(0.46, -0.12, 0.9 + state.spinAngle)
      },

      resize() {},

      dispose({ camera, scene }) {
        if (movementKeyBlockHandler) {
          window.removeEventListener('keydown', movementKeyBlockHandler, true)
          window.removeEventListener('keyup', movementKeyBlockHandler, true)
          movementKeyBlockHandler = null
        }

        if (camera) {
          camera.near = savedCameraNear || camera.near
          camera.far = savedCameraFar || camera.far
          camera.fov = savedCameraFov || camera.fov
          camera.updateProjectionMatrix()
        }

        if (scene) {
          scene.background = savedBackground ?? scene.background
        }

        if (sceneGroup) {
          disposeObject3D(sceneGroup)
          sceneGroup = null
        }

        shipRig = null
        endurance = null
        cameraLockedPosition = null
      },
    }
  },
}
