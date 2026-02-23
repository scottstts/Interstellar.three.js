import * as THREE from 'three/webgpu'
import { SkyMesh } from 'three/addons/objects/SkyMesh.js'
import { disposeObject3D } from '../utils/dispose'

const CORNFIELD_CAMERA_GROUND_CLEARANCE = 0.75

function getCornfieldGroundHeightAt(x, z) {
  return (
    Math.sin(x * 0.015 + z * 0.01) * 0.5 +
    Math.sin(x * 0.04) * 0.15 +
    Math.cos(z * 0.03) * 0.2
  )
}

function clampCameraToCornfieldGround(camera) {
  if (!camera) {
    return
  }

  const surfaceY = getCornfieldGroundHeightAt(camera.position.x, camera.position.z)
  const minimumY = surfaceY + CORNFIELD_CAMERA_GROUND_CLEARANCE

  if (camera.position.y < minimumY) {
    camera.position.y = minimumY
    camera.updateMatrixWorld()
  }
}

/* ------------------------------------------------------------------ */
/*  Scene 02 – Cornfield Drone Chase                                   */
/*  Cooper's truck plows through dense cornstalks chasing an Indian    */
/*  surveillance drone gliding overhead against a clear blue sky.       */
/* ------------------------------------------------------------------ */

export default {
  id: 'cornfield-drone-chase',
  title: 'Cornfield Drone Chase',

  create() {
    let group = null
    let prevBg = null
    let prevFog = null

    let truck = null
    let drone = null
    let cornInstances = null
    let cornTasselInstances = null
    let leafUpperInstances = null
    let leafLowerInstances = null
    let ambientDust = null
    let trailParticles = null

    let skyMesh = null
    let sunDisk = null
    let sunDirection = null
    let sunLight = null

    /* path data */
    const truckPath = []
    const PATH_SEGMENTS = 300
    let truckT = 0.0
    const TRUCK_SPEED = 0.04

    /* corn data – field fills the visible ground, density ~1.5/m² */
    const CORN_COUNT = 400000
    const FIELD_HALF_X = 220
    const FIELD_HALF_Z = 220
    const FIELD_CENTER_Z = -30
    const CULL_RADIUS = 25 /* only update matrices within this of truck */
    const CULL_RADIUS_SQ = CULL_RADIUS * CULL_RADIUS
    const cornBasePositions = []
    const cornBendFactors = []

    /* drone */
    const DRONE_ALT = 18
    const DRONE_LEAD = 0.025

    return {
      init({ root, scene, camera }) {
        group = new THREE.Group()
        group.name = 'cornfield-drone-group'
        root.add(group)

        prevBg = scene.background
        prevFog = scene.fog

        /* warm golden-hour atmosphere */
        scene.background = new THREE.Color(0x6aaed6)
        scene.fog = new THREE.Fog(0xa8c8dd, 30, 260)

        /* elevated cinematic vantage – lowered for more immersion */
        camera.position.set(20, 10, 60)
        camera.lookAt(0, 2, -20)
        clampCameraToCornfieldGround(camera)

        buildTruckPath()
        buildSkyDome()
        buildGround()
        buildCornfield()
        buildTruck()
        buildDrone()
        buildDustSystems()
        buildLighting()
      },

      update({ delta, elapsed, camera }) {
        if (!group) return

        clampCameraToCornfieldGround(camera)

        /* advance truck — detect loop wrap and reset bent corn */
        const prevT = truckT
        truckT = (truckT + TRUCK_SPEED * delta) % 1
        if (truckT < prevT) {
          resetCornField()
        }
        const tp = samplePath(truckT)
        const tpNext = samplePath(truckT + 0.002)
        const tDir = subVec(tpNext, tp)
        const tHeading = Math.atan2(tDir.x, tDir.z)

        if (truck) {
          const bump = Math.sin(elapsed * 14) * 0.06 + Math.sin(elapsed * 9.3) * 0.04
          truck.position.set(tp.x, 0.55 + bump, tp.z)
          truck.rotation.y = tHeading + Math.PI
          /* wheel spin */
          truck.userData.wheels?.forEach((w) => {
            w.rotation.x += delta * 28
          })
        }

        /* drone leads truck */
        if (drone) {
          const droneT = (truckT + DRONE_LEAD) % 1
          const dp = samplePath(droneT)
          const dpN = samplePath(droneT + 0.002)
          const dDir = subVec(dpN, dp)

          drone.position.set(
            dp.x + Math.sin(elapsed * 0.6) * 2.5,
            DRONE_ALT + Math.sin(elapsed * 0.9) * 1.2,
            dp.z + Math.cos(elapsed * 0.45) * 1.5,
          )
          drone.rotation.y = Math.atan2(dDir.x, dDir.z) + Math.PI
          drone.rotation.z = Math.sin(elapsed * 1.1) * 0.04
          drone.rotation.x = Math.sin(elapsed * 0.7) * 0.02
        }

        /* bend corn near truck */
        if (cornInstances) {
          updateCornBending(tp, delta, elapsed)
        }

        /* truck dust trail */
        if (trailParticles) {
          updateDustTrail(tp, tHeading, delta)
        }

        /* ambient dust drift */
        if (ambientDust) {
          const pos = ambientDust.geometry.attributes.position.array
          const cnt = ambientDust.userData.count
          for (let i = 0; i < cnt; i++) {
            const i3 = i * 3
            pos[i3] += Math.sin(elapsed * 0.25 + i * 1.3) * delta * 0.5
            pos[i3 + 1] += Math.sin(elapsed * 0.4 + i * 0.9) * delta * 0.12
            pos[i3 + 2] += Math.cos(elapsed * 0.18 + i * 0.6) * delta * 0.4
          }
          ambientDust.geometry.attributes.position.needsUpdate = true
        }
      },

      resize() {},

      dispose({ scene }) {
        if (scene) {
          scene.background = prevBg
          scene.fog = prevFog
        }
        if (group) disposeObject3D(group)
        group = null
        truck = null
        drone = null
        cornInstances = null
        cornTasselInstances = null
        leafUpperInstances = null
        leafLowerInstances = null
        ambientDust = null
        trailParticles = null
        skyMesh = null
        sunDisk = null
        sunDirection = null
        sunLight = null
      },
    }

    /* ============================================================== */
    /*  CORN RESET on loop                                              */
    /* ============================================================== */
    function resetCornField() {
      const dummy = new THREE.Object3D()
      for (let i = 0; i < CORN_COUNT; i++) {
        if (cornBendFactors[i] === 0) continue
        cornBendFactors[i] = 0
        const bp = cornBasePositions[i]
        dummy.position.set(bp.x, bp.y, bp.z)
        dummy.rotation.set(0, bp.ry, 0)
        dummy.scale.set(bp.sx, bp.sy, bp.sx)
        dummy.updateMatrix()
        cornInstances.setMatrixAt(i, dummy.matrix)
        if (cornTasselInstances) {
          cornTasselInstances.setMatrixAt(i, dummy.matrix)
        }
        if (leafUpperInstances) {
          leafUpperInstances.setMatrixAt(i, dummy.matrix)
        }
        if (leafLowerInstances) {
          leafLowerInstances.setMatrixAt(i, dummy.matrix)
        }
      }
      if (cornInstances) cornInstances.instanceMatrix.needsUpdate = true
      if (cornTasselInstances) cornTasselInstances.instanceMatrix.needsUpdate = true
      if (leafUpperInstances) leafUpperInstances.instanceMatrix.needsUpdate = true
      if (leafLowerInstances) leafLowerInstances.instanceMatrix.needsUpdate = true
    }

    /* ============================================================== */
    /*  CORN BENDING                                                    */
    /* ============================================================== */
    function updateCornBending(tp, delta, elapsed) {
      const dummy = new THREE.Object3D()
      const BEND_RADIUS = 3.2
      const BEND_RADIUS_SQ = BEND_RADIUS * BEND_RADIUS
      const BEND_SPEED = 5.0
      let updated = false

      for (let i = 0; i < CORN_COUNT; i++) {
        const bp = cornBasePositions[i]
        const dx = bp.x - tp.x
        const dz = bp.z - tp.z
        const distSq = dx * dx + dz * dz

        /* skip stalks far from truck that haven't been bent */
        if (distSq > CULL_RADIUS_SQ && cornBendFactors[i] === 0) continue

        if (distSq < BEND_RADIUS_SQ) {
          cornBendFactors[i] = Math.min(cornBendFactors[i] + delta * BEND_SPEED, 1.0)
        }

        const bend = cornBendFactors[i]
        const wind = Math.sin(elapsed * 2.8 + bp.x * 0.5 + bp.z * 0.35) * 0.07 * (1 - bend * 0.8)

        dummy.position.set(bp.x, bp.y, bp.z)
        dummy.rotation.set(0, bp.ry, 0)

        if (bend > 0.005) {
          const dist = Math.sqrt(distSq) + 0.001
          const awayX = dx / dist
          const awayZ = dz / dist
          const angle = bend * 1.4
          dummy.rotation.x = angle * awayZ + wind
          dummy.rotation.z = -angle * awayX
          dummy.scale.set(bp.sx, bp.sy * (1 - bend * 0.4), bp.sx)
        } else {
          dummy.rotation.x = wind
          dummy.rotation.z = 0
          dummy.scale.set(bp.sx, bp.sy, bp.sx)
        }

        dummy.updateMatrix()
        cornInstances.setMatrixAt(i, dummy.matrix)
        if (cornTasselInstances) {
          cornTasselInstances.setMatrixAt(i, dummy.matrix)
        }
        if (leafUpperInstances) {
          leafUpperInstances.setMatrixAt(i, dummy.matrix)
        }
        if (leafLowerInstances) {
          leafLowerInstances.setMatrixAt(i, dummy.matrix)
        }
        updated = true
      }

      if (updated) cornInstances.instanceMatrix.needsUpdate = true
      if (updated && cornTasselInstances) cornTasselInstances.instanceMatrix.needsUpdate = true
      if (updated && leafUpperInstances) leafUpperInstances.instanceMatrix.needsUpdate = true
      if (updated && leafLowerInstances) leafLowerInstances.instanceMatrix.needsUpdate = true
    }

    /* ============================================================== */
    /*  DUST TRAIL UPDATE                                               */
    /* ============================================================== */
    function updateDustTrail(tp, heading, delta) {
      const positions = trailParticles.geometry.attributes.position.array
      const sizes = trailParticles.geometry.attributes.size.array
      const vel = trailParticles.userData.velocities
      const ages = trailParticles.userData.ages
      const maxAge = trailParticles.userData.maxAge
      const cnt = trailParticles.userData.count

      /* emit behind truck */
      const behindX = tp.x - Math.sin(heading) * 3.5
      const behindZ = tp.z - Math.cos(heading) * 3.5

      for (let i = 0; i < cnt; i++) {
        ages[i] += delta
        if (ages[i] > maxAge) {
          positions[i * 3] = behindX + (Math.random() - 0.5) * 2.5
          positions[i * 3 + 1] = 0.2 + Math.random() * 0.4
          positions[i * 3 + 2] = behindZ + (Math.random() - 0.5) * 2.5
          vel[i * 3] = (Math.random() - 0.5) * 3.5
          vel[i * 3 + 1] = 2.0 + Math.random() * 3.5
          vel[i * 3 + 2] = (Math.random() - 0.5) * 3.5
          ages[i] = 0
        }
        const life = ages[i] / maxAge
        const drag = 1 - life * 0.6
        positions[i * 3] += vel[i * 3] * delta * drag
        positions[i * 3 + 1] += vel[i * 3 + 1] * delta * (1 - life * 0.8)
        positions[i * 3 + 2] += vel[i * 3 + 2] * delta * drag
        /* grow then fade */
        sizes[i] = (life < 0.3 ? life / 0.3 : 1) * (1 - life * 0.5) * 2.5
      }
      trailParticles.geometry.attributes.position.needsUpdate = true
      trailParticles.geometry.attributes.size.needsUpdate = true
    }

    /* ============================================================== */
    /*  BUILD FUNCTIONS                                                 */
    /* ============================================================== */

    function buildTruckPath() {
      /* S-curve centered on field, traveling roughly from +z to -z
         so the elevated camera sees the truck carve through corn */
      for (let i = 0; i < PATH_SEGMENTS; i++) {
        const t = i / PATH_SEGMENTS
        const z = FIELD_CENTER_Z + (0.5 - t) * 180
        const x = Math.sin(t * Math.PI * 3) * 20
        truckPath.push({ x, z })
      }
    }

    function buildSkyDome() {
      /* WebGPU-native procedural sky */
      sunDirection = new THREE.Vector3(80, 100, -180).normalize()

      skyMesh = new SkyMesh()
      /* keep the dome within typical camera far planes */
      skyMesh.scale.setScalar(480)
      skyMesh.frustumCulled = false
      group.add(skyMesh)

      /* parameters (matching the WebGPU demo defaults) */
      skyMesh.turbidity.value = 10
      skyMesh.rayleigh.value = 2
      skyMesh.mieCoefficient.value = 0.005
      skyMesh.mieDirectionalG.value = 0.8
      skyMesh.sunPosition.value.copy(sunDirection)

      /* visible sun disk (scaled to match the dome size) */
      const sunRadius = (120 / 50000) * 480
      sunDisk = new THREE.Mesh(
        new THREE.SphereGeometry(sunRadius, 32, 16),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      )
      sunDisk.position.copy(sunDirection).multiplyScalar(480 * 0.95)
      group.add(sunDisk)
    }

    function buildGround() {
      /* rich soil canvas texture */
      const canvas = document.createElement('canvas')
      canvas.width = 1024
      canvas.height = 1024
      const ctx = canvas.getContext('2d')

      /* layered soil fill */
      ctx.fillStyle = '#7a6543'
      ctx.fillRect(0, 0, 1024, 1024)

      /* clumps and organic variation */
      for (let i = 0; i < 30000; i++) {
        const gx = Math.random() * 1024
        const gy = Math.random() * 1024
        const size = 1 + Math.random() * 3
        const b = 80 + Math.floor(Math.random() * 80)
        const rOff = Math.floor(Math.random() * 30)
        ctx.fillStyle = `rgb(${b + rOff + 20},${b + rOff},${b - 10})`
        ctx.fillRect(gx, gy, size, size)
      }

      /* subtle furrow lines */
      ctx.strokeStyle = 'rgba(60,45,25,0.12)'
      ctx.lineWidth = 1
      for (let row = 0; row < 1024; row += 12 + Math.random() * 6) {
        ctx.beginPath()
        ctx.moveTo(0, row)
        ctx.lineTo(1024, row + (Math.random() - 0.5) * 4)
        ctx.stroke()
      }

      const tex = new THREE.CanvasTexture(canvas)
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(30, 30)
      tex.anisotropy = 4

      const groundGeo = new THREE.PlaneGeometry(600, 600, 80, 80)
      groundGeo.rotateX(-Math.PI / 2)

      /* rolling undulation */
      const posArr = groundGeo.attributes.position.array
      for (let i = 0; i < posArr.length; i += 3) {
        const gx = posArr[i]
        const gz = posArr[i + 2]
        posArr[i + 1] +=
          Math.sin(gx * 0.015 + gz * 0.01) * 0.5 +
          Math.sin(gx * 0.04) * 0.15 +
          Math.cos(gz * 0.03) * 0.2
      }
      groundGeo.computeVertexNormals()

      const groundMat = new THREE.MeshStandardMaterial({
        map: tex,
        color: 0xb09870,
        roughness: 0.92,
        metalness: 0.0,
      })
      const ground = new THREE.Mesh(groundGeo, groundMat)
      ground.name = 'ground'
      group.add(ground)
    }

    function buildCornfield() {
      const stalkGeo = new THREE.CylinderGeometry(0.03, 0.06, 2.2, 7)
      stalkGeo.translate(0, 1.1, 0)
      const leafUpperGeo = new THREE.BoxGeometry(1.05, 0.05, 0.14)
      leafUpperGeo.translate(0.33, 1.02, 0)
      leafUpperGeo.rotateZ(0.58)
      const leafLowerGeo = new THREE.BoxGeometry(0.92, 0.045, 0.12)
      leafLowerGeo.translate(-0.3, 1.34, 0)
      leafLowerGeo.rotateZ(-0.52)
      const tasselGeo = new THREE.ConeGeometry(0.08, 0.34, 6)
      tasselGeo.translate(0, 2.22, 0)

      const stalkMat = new THREE.MeshStandardMaterial({
        color: 0x8a9840,
        metalness: 0.01,
        roughness: 0.92,
        vertexColors: true,
      })
      const leafMat = new THREE.MeshStandardMaterial({
        color: 0x9cab4b,
        metalness: 0.01,
        roughness: 0.9,
        vertexColors: true,
      })
      const tasselMat = new THREE.MeshStandardMaterial({
        color: 0xaf9a57,
        metalness: 0.01,
        roughness: 0.88,
        vertexColors: true,
      })

      cornInstances = new THREE.InstancedMesh(stalkGeo, stalkMat, CORN_COUNT)
      cornInstances.name = 'corn-stalks'
      cornTasselInstances = new THREE.InstancedMesh(tasselGeo, tasselMat, CORN_COUNT)
      cornTasselInstances.name = 'corn-tassels'
      leafUpperInstances = new THREE.InstancedMesh(leafUpperGeo, leafMat, CORN_COUNT)
      leafUpperInstances.name = 'corn-leaf-upper'
      leafLowerInstances = new THREE.InstancedMesh(leafLowerGeo, leafMat, CORN_COUNT)
      leafLowerInstances.name = 'corn-leaf-lower'

      const dummy = new THREE.Object3D()
      const stalkColor = new THREE.Color()
      const leafColor = new THREE.Color()
      const tasselColor = new THREE.Color()

      for (let i = 0; i < CORN_COUNT; i++) {
        /* no path clearance — field is solid, truck plows its own trail */
        const cx = (Math.random() - 0.5) * FIELD_HALF_X * 2
        const cz = FIELD_CENTER_Z + (Math.random() - 0.5) * FIELD_HALF_Z * 2

        const sy = 0.9 + Math.random() * 0.75
        const sx = 1
        const ry = Math.random() * Math.PI * 2

        dummy.position.set(cx, 0, cz)
        dummy.rotation.set(0, ry, 0)
        dummy.scale.set(sx, sy, sx)
        dummy.updateMatrix()
        cornInstances.setMatrixAt(i, dummy.matrix)
        if (cornTasselInstances) {
          cornTasselInstances.setMatrixAt(i, dummy.matrix)
        }
        if (leafUpperInstances) {
          leafUpperInstances.setMatrixAt(i, dummy.matrix)
        }
        if (leafLowerInstances) {
          leafLowerInstances.setMatrixAt(i, dummy.matrix)
        }

        stalkColor.setHSL(0.17 + Math.random() * 0.05, 0.44, 0.34 + Math.random() * 0.11)
        leafColor.copy(stalkColor).offsetHSL(-0.01, 0.06, 0.04)
        tasselColor.copy(stalkColor).offsetHSL(-0.03, -0.1, 0.2)
        cornInstances.setColorAt(i, stalkColor)
        if (leafUpperInstances) {
          leafUpperInstances.setColorAt(i, leafColor)
        }
        if (leafLowerInstances) {
          leafLowerInstances.setColorAt(i, leafColor)
        }
        if (cornTasselInstances) {
          cornTasselInstances.setColorAt(i, tasselColor)
        }

        cornBasePositions.push({ x: cx, y: 0, z: cz, ry, sx, sy })
        cornBendFactors.push(0)
      }

      cornInstances.instanceMatrix.needsUpdate = true
      cornInstances.instanceColor.needsUpdate = true
      cornTasselInstances.instanceMatrix.needsUpdate = true
      cornTasselInstances.instanceColor.needsUpdate = true
      if (leafUpperInstances) {
        leafUpperInstances.instanceMatrix.needsUpdate = true
        if (leafUpperInstances.instanceColor) {
          leafUpperInstances.instanceColor.needsUpdate = true
        }
      }
      if (leafLowerInstances) {
        leafLowerInstances.instanceMatrix.needsUpdate = true
        if (leafLowerInstances.instanceColor) {
          leafLowerInstances.instanceColor.needsUpdate = true
        }
      }

      group.add(cornInstances)
      group.add(cornTasselInstances)
      if (leafUpperInstances) {
        group.add(leafUpperInstances)
      }
      if (leafLowerInstances) {
        group.add(leafLowerInstances)
      }
    }

    function buildTruck() {
      truck = new THREE.Group()
      truck.name = 'pickup-truck'

      const rustyPaint = new THREE.MeshStandardMaterial({
        color: 0x7c5e3a,
        roughness: 0.78,
        metalness: 0.18,
      })
      const darkMetal = new THREE.MeshStandardMaterial({
        color: 0x3a3530,
        roughness: 0.6,
        metalness: 0.35,
      })
      const chrome = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        roughness: 0.15,
        metalness: 0.85,
      })

      /* chassis / underbody */
      const chassisGeo = new THREE.BoxGeometry(2.0, 0.25, 5.0)
      const chassis = new THREE.Mesh(chassisGeo, darkMetal)
      chassis.position.set(0, 0.25, 0)
      truck.add(chassis)

      /* main body */
      const bodyGeo = new THREE.BoxGeometry(2.15, 1.0, 4.8)
      const body = new THREE.Mesh(bodyGeo, rustyPaint)
      body.position.set(0, 0.85, 0)
      truck.add(body)

      /* cab */
      const cabGeo = new THREE.BoxGeometry(2.0, 0.95, 2.2)
      const cabMat = new THREE.MeshStandardMaterial({
        color: 0x6d4e30,
        roughness: 0.72,
        metalness: 0.15,
      })
      const cab = new THREE.Mesh(cabGeo, cabMat)
      cab.position.set(0, 1.85, -0.7)
      truck.add(cab)

      /* roof */
      const roofGeo = new THREE.BoxGeometry(2.1, 0.08, 2.3)
      const roof = new THREE.Mesh(roofGeo, rustyPaint)
      roof.position.set(0, 2.35, -0.7)
      truck.add(roof)

      /* windshield front */
      const wGeo = new THREE.PlaneGeometry(1.85, 0.8)
      const glassMat = new THREE.MeshStandardMaterial({
        color: 0x8ab4cc,
        roughness: 0.05,
        metalness: 0.4,
        transparent: true,
        opacity: 0.45,
      })
      const windshield = new THREE.Mesh(wGeo, glassMat)
      windshield.position.set(0, 2.0, 0.42)
      windshield.rotation.x = -0.2
      truck.add(windshield)

      /* rear window */
      const rwGeo = new THREE.PlaneGeometry(1.7, 0.6)
      const rw = new THREE.Mesh(rwGeo, glassMat)
      rw.position.set(0, 2.0, -1.82)
      rw.rotation.x = 0.15
      truck.add(rw)

      /* side windows */
      for (const side of [-1, 1]) {
        const swGeo = new THREE.PlaneGeometry(1.6, 0.55)
        const sw = new THREE.Mesh(swGeo, glassMat)
        sw.position.set(side * 1.01, 2.0, -0.7)
        sw.rotation.y = side * Math.PI / 2
        truck.add(sw)
      }

      /* truck bed */
      const bedFloor = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 2.3), darkMetal)
      bedFloor.position.set(0, 1.4, 1.55)
      truck.add(bedFloor)

      /* bed walls */
      const bedSideGeo = new THREE.BoxGeometry(0.08, 0.65, 2.3)
      for (const side of [-1, 1]) {
        const wall = new THREE.Mesh(bedSideGeo, rustyPaint)
        wall.position.set(side * 1.0, 1.75, 1.55)
        truck.add(wall)
      }
      const tailgate = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.65, 0.08), rustyPaint)
      tailgate.position.set(0, 1.75, 2.7)
      truck.add(tailgate)

      /* bumpers */
      for (const [bz, label] of [[-2.45, 'front'], [2.72, 'rear']]) {
        const bGeo = new THREE.BoxGeometry(2.3, 0.18, 0.12)
        const bumper = new THREE.Mesh(bGeo, chrome)
        bumper.position.set(0, 0.45, bz)
        bumper.name = `bumper-${label}`
        truck.add(bumper)
      }

      /* grille */
      const grilleGeo = new THREE.BoxGeometry(1.6, 0.5, 0.06)
      const grilleMat = new THREE.MeshStandardMaterial({
        color: 0x555555,
        roughness: 0.3,
        metalness: 0.7,
      })
      const grille = new THREE.Mesh(grilleGeo, grilleMat)
      grille.position.set(0, 0.75, -2.42)
      truck.add(grille)

      /* headlights */
      const hlGeo = new THREE.CircleGeometry(0.14, 10)
      const hlMat = new THREE.MeshStandardMaterial({
        color: 0xfffff0,
        emissive: 0xffffc8,
        emissiveIntensity: 0.6,
        roughness: 0.1,
      })
      for (const sx of [-0.7, 0.7]) {
        const hl = new THREE.Mesh(hlGeo, hlMat)
        hl.position.set(sx, 0.9, -2.43)
        truck.add(hl)
      }

      /* taillights */
      const tlGeo = new THREE.CircleGeometry(0.1, 8)
      const tlMat = new THREE.MeshStandardMaterial({
        color: 0xff2020,
        emissive: 0xcc0000,
        emissiveIntensity: 0.5,
        roughness: 0.3,
      })
      for (const sx of [-0.8, 0.8]) {
        const tl = new THREE.Mesh(tlGeo, tlMat)
        tl.position.set(sx, 0.8, 2.73)
        tl.rotation.y = Math.PI
        truck.add(tl)
      }

      /* side mirrors */
      for (const side of [-1, 1]) {
        const mArm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.04), darkMetal)
        mArm.position.set(side * 1.25, 1.9, 0.1)
        truck.add(mArm)
        const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.04), chrome)
        mirror.position.set(side * 1.45, 1.9, 0.1)
        truck.add(mirror)
      }

      /* wheels */
      const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.28, 14)
      wheelGeo.rotateZ(Math.PI / 2)
      const tireMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 0.95,
        metalness: 0.0,
      })
      const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.30, 8)
      hubGeo.rotateZ(Math.PI / 2)

      truck.userData.wheels = []
      const wheelPos = [
        [-1.15, 0.42, -1.4],
        [1.15, 0.42, -1.4],
        [-1.15, 0.42, 1.6],
        [1.15, 0.42, 1.6],
      ]
      for (const [wx, wy, wz] of wheelPos) {
        const pivot = new THREE.Group()
        pivot.position.set(wx, wy, wz)
        pivot.add(new THREE.Mesh(wheelGeo, tireMat))
        pivot.add(new THREE.Mesh(hubGeo, chrome))
        truck.add(pivot)
        truck.userData.wheels.push(pivot)
      }

      /* fender flares */
      const fenderGeo = new THREE.BoxGeometry(0.12, 0.2, 1.0)
      for (const side of [-1, 1]) {
        for (const [fz] of [[-1.4], [1.6]]) {
          const fender = new THREE.Mesh(fenderGeo, rustyPaint)
          fender.position.set(side * 1.12, 0.65, fz)
          truck.add(fender)
        }
      }

      /* antenna */
      const antGeo = new THREE.CylinderGeometry(0.01, 0.015, 1.5, 4)
      const antMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.6, roughness: 0.3 })
      const ant = new THREE.Mesh(antGeo, antMat)
      ant.position.set(-0.8, 3.1, -0.9)
      ant.rotation.z = 0.08
      truck.add(ant)

      /* initial position */
      const sp = truckPath[0]
      truck.position.set(sp.x, 0.55, sp.z)
      group.add(truck)
    }

    function buildDrone() {
      drone = new THREE.Group()
      drone.name = 'surveillance-drone'

      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0xd8dce2,
        roughness: 0.25,
        metalness: 0.55,
      })
      const solarMat = new THREE.MeshStandardMaterial({
        color: 0x0a0a28,
        roughness: 0.05,
        metalness: 0.85,
      })
      const darkTrim = new THREE.MeshStandardMaterial({
        color: 0x2a2a35,
        roughness: 0.3,
        metalness: 0.6,
      })

      /* tapered fuselage */
      const fuselageGeo = new THREE.CylinderGeometry(0.25, 0.45, 4.5, 8)
      fuselageGeo.rotateX(Math.PI / 2)
      const fuselage = new THREE.Mesh(fuselageGeo, bodyMat)
      drone.add(fuselage)

      /* nose cone */
      const noseGeo = new THREE.ConeGeometry(0.25, 1.2, 8)
      noseGeo.rotateX(-Math.PI / 2)
      const nose = new THREE.Mesh(noseGeo, bodyMat)
      nose.position.set(0, 0, -2.85)
      drone.add(nose)

      /* camera dome under nose */
      const camGeo = new THREE.SphereGeometry(0.2, 10, 10, 0, Math.PI * 2, 0, Math.PI * 0.6)
      const camMat = new THREE.MeshStandardMaterial({
        color: 0x050505,
        roughness: 0.05,
        metalness: 0.9,
      })
      const cam = new THREE.Mesh(camGeo, camMat)
      cam.position.set(0, -0.3, -2.4)
      cam.rotation.x = Math.PI
      drone.add(cam)

      /* main wings */
      const wingGeo = new THREE.BoxGeometry(14, 0.06, 2.0)
      const wings = new THREE.Mesh(wingGeo, darkTrim)
      wings.position.set(0, 0.05, -0.3)
      drone.add(wings)

      /* solar panels on top of wings */
      const solarGeo = new THREE.BoxGeometry(13.5, 0.02, 1.7)
      const solar = new THREE.Mesh(solarGeo, solarMat)
      solar.position.set(0, 0.12, -0.3)
      drone.add(solar)

      /* solar grid lines */
      const gridMat = new THREE.MeshBasicMaterial({ color: 0x222244 })
      for (let gi = -6; gi <= 6; gi++) {
        const g = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.025, 1.7), gridMat)
        g.position.set(gi * 1.0, 0.14, -0.3)
        drone.add(g)
      }

      /* tail boom */
      const boomGeo = new THREE.CylinderGeometry(0.08, 0.12, 2.5, 6)
      boomGeo.rotateX(Math.PI / 2)
      const boom = new THREE.Mesh(boomGeo, bodyMat)
      boom.position.set(0, 0.05, 3.4)
      drone.add(boom)

      /* horizontal stabilizer */
      const hstabGeo = new THREE.BoxGeometry(4, 0.04, 0.7)
      const hstab = new THREE.Mesh(hstabGeo, darkTrim)
      hstab.position.set(0, 0.1, 4.5)
      drone.add(hstab)

      /* V-tail fins */
      for (const side of [-1, 1]) {
        const finGeo = new THREE.BoxGeometry(0.04, 1.0, 0.5)
        const fin = new THREE.Mesh(finGeo, bodyMat)
        fin.position.set(side * 0.3, 0.6, 4.5)
        fin.rotation.z = side * 0.3
        drone.add(fin)
      }

      drone.position.set(0, DRONE_ALT, 0)
      drone.scale.set(0.55, 0.55, 0.55)
      group.add(drone)
    }

    function buildDustSystems() {
      /* truck dust trail */
      const TRAIL_COUNT = 500
      const tGeo = new THREE.BufferGeometry()
      const tPos = new Float32Array(TRAIL_COUNT * 3)
      const tSizes = new Float32Array(TRAIL_COUNT)
      const velocities = new Float32Array(TRAIL_COUNT * 3)
      const ages = new Float32Array(TRAIL_COUNT)
      const maxAge = 4.0

      for (let i = 0; i < TRAIL_COUNT; i++) {
        tPos[i * 3] = 9999 /* off-screen initially */
        tPos[i * 3 + 1] = -10
        tPos[i * 3 + 2] = 9999
        tSizes[i] = 0
        ages[i] = maxAge * Math.random()
      }

      tGeo.setAttribute('position', new THREE.Float32BufferAttribute(tPos, 3))
      tGeo.setAttribute('size', new THREE.Float32BufferAttribute(tSizes, 1))

      const trailMat = new THREE.PointsMaterial({
        color: 0xc8a87a,
        size: 1.8,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      })

      trailParticles = new THREE.Points(tGeo, trailMat)
      trailParticles.name = 'truck-dust'
      trailParticles.userData = { count: TRAIL_COUNT, velocities, ages, maxAge }
      group.add(trailParticles)

      /* ambient dust */
      const AMB_COUNT = 800
      const aGeo = new THREE.BufferGeometry()
      const aPos = new Float32Array(AMB_COUNT * 3)
      for (let i = 0; i < AMB_COUNT; i++) {
        aPos[i * 3] = (Math.random() - 0.5) * 160
        aPos[i * 3 + 1] = 0.3 + Math.random() * 12
        aPos[i * 3 + 2] = FIELD_CENTER_Z + (Math.random() - 0.5) * 200
      }
      aGeo.setAttribute('position', new THREE.Float32BufferAttribute(aPos, 3))

      const aMat = new THREE.PointsMaterial({
        color: 0xd4c09a,
        size: 0.35,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
      })
      ambientDust = new THREE.Points(aGeo, aMat)
      ambientDust.name = 'ambient-dust'
      ambientDust.userData = { count: AMB_COUNT }
      group.add(ambientDust)
    }

    function buildLighting() {
      /* realistic sun + minimal ambient (aligned with SkyMesh sunPosition) */
      sunLight = new THREE.DirectionalLight(0xffffff, 6.0)
      const dir = (sunDirection || new THREE.Vector3(80, 100, -180).normalize()).clone()
      sunLight.position.copy(dir).multiplyScalar(200)
      group.add(sunLight)

      const ambient = new THREE.AmbientLight(0xffffff, 0.03)
      group.add(ambient)
    }

    /* ---- helpers ---- */
    function samplePath(t) {
      const tt = ((t % 1) + 1) % 1
      const idx = tt * (PATH_SEGMENTS - 1)
      const i0 = Math.floor(idx)
      const i1 = Math.min(i0 + 1, PATH_SEGMENTS - 1)
      const f = idx - i0
      return lerpVec(truckPath[i0], truckPath[i1], f)
    }

    function lerpVec(a, b, t) {
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
    }

    function subVec(a, b) {
      return { x: a.x - b.x, z: a.z - b.z }
    }
  },
}
