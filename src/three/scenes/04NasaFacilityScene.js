import * as THREE from 'three/webgpu'
import { disposeObject3D } from '../utils/dispose'

const ROOM_WIDTH = 38
const ROOM_DEPTH = 28
const ROOM_HEIGHT = 10.5
const WALL_THICKNESS = 0.45
const CAMERA_ROOM_FLOOR_CLEARANCE = 0.35
const CAMERA_ROOM_CEILING_CLEARANCE = 0.35
const CAMERA_ROOM_WALL_CLEARANCE = 0.12

function clampCameraToNasaRoom(camera) {
  if (!camera) {
    return
  }

  const minX = -ROOM_WIDTH * 0.5 + WALL_THICKNESS * 0.5 + CAMERA_ROOM_WALL_CLEARANCE
  const maxX = ROOM_WIDTH * 0.5 - WALL_THICKNESS * 0.5 - CAMERA_ROOM_WALL_CLEARANCE
  const minZ = -ROOM_DEPTH * 0.5 + WALL_THICKNESS * 0.5 + CAMERA_ROOM_WALL_CLEARANCE
  const maxZ = ROOM_DEPTH * 0.5 - WALL_THICKNESS * 0.5 - CAMERA_ROOM_WALL_CLEARANCE
  const minY = CAMERA_ROOM_FLOOR_CLEARANCE
  const maxY = ROOM_HEIGHT - CAMERA_ROOM_CEILING_CLEARANCE

  const nextX = THREE.MathUtils.clamp(camera.position.x, minX, maxX)
  const nextY = THREE.MathUtils.clamp(camera.position.y, minY, maxY)
  const nextZ = THREE.MathUtils.clamp(camera.position.z, minZ, maxZ)

  if (nextX !== camera.position.x || nextY !== camera.position.y || nextZ !== camera.position.z) {
    camera.position.set(nextX, nextY, nextZ)
    camera.updateMatrixWorld()
  }
}

function createRng(seed) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

function createCarpetTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 1024
  const ctx = canvas.getContext('2d')
  const rng = createRng(404)

  ctx.fillStyle = '#5a5b60'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  for (let i = 0; i < 2400; i += 1) {
    const x = rng() * canvas.width
    const y = rng() * canvas.height
    const brightness = 88 + Math.floor(rng() * 26)
    ctx.fillStyle = `rgba(${brightness}, ${brightness}, ${brightness + 4}, 0.11)`
    ctx.fillRect(x, y, 1.2, 1.2)
  }

  ctx.strokeStyle = 'rgba(150, 153, 162, 0.42)'
  ctx.lineWidth = 2
  const centerX = -120
  const centerY = canvas.height + 130

  for (let radius = 180; radius < 1900; radius += 38) {
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, -Math.PI * 0.04, -Math.PI * 0.95, true)
    ctx.stroke()
  }

  const vignette = ctx.createRadialGradient(canvas.width * 0.5, canvas.height * 0.2, 140, canvas.width * 0.5, canvas.height * 0.4, 900)
  vignette.addColorStop(0, 'rgba(255, 255, 255, 0.03)')
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.2)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1.15, 1.05)
  return texture
}

function createWoodPanelTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  const rng = createRng(2001)

  ctx.fillStyle = '#6a412d'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  for (let x = 0; x < canvas.width; x += 5) {
    const hueShift = Math.floor(rng() * 28) - 14
    ctx.strokeStyle = `rgba(${130 + hueShift}, ${84 + hueShift * 0.42}, ${58 + hueShift * 0.3}, 0.3)`
    ctx.lineWidth = 1 + rng() * 1.5
    ctx.beginPath()
    ctx.moveTo(x + rng() * 2, 0)
    ctx.bezierCurveTo(
      x + 8 + rng() * 6,
      canvas.height * 0.28,
      x - 9 + rng() * 7,
      canvas.height * 0.72,
      x + rng() * 2,
      canvas.height,
    )
    ctx.stroke()
  }

  for (let i = 0; i < 7; i += 1) {
    const seamX = 28 + i * 72 + rng() * 10
    ctx.strokeStyle = 'rgba(62, 39, 26, 0.32)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(seamX, 0)
    ctx.lineTo(seamX, canvas.height)
    ctx.stroke()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(4.6, 1.5)
  return texture
}

function createPortraitTexture(index) {
  const canvas = document.createElement('canvas')
  canvas.width = 180
  canvas.height = 260
  const ctx = canvas.getContext('2d')
  const rng = createRng(140 + index * 19)

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height)
  gradient.addColorStop(0, '#1e1d1f')
  gradient.addColorStop(1, '#2a2321')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const skinTone = 110 + Math.floor(rng() * 80)
  const shirtTone = 40 + Math.floor(rng() * 70)

  ctx.fillStyle = `rgba(${shirtTone}, ${shirtTone + 6}, ${shirtTone + 14}, 0.95)`
  ctx.fillRect(56, 164, 68, 62)

  ctx.fillStyle = `rgba(${skinTone}, ${Math.max(90, skinTone - 15)}, ${Math.max(80, skinTone - 32)}, 0.95)`
  ctx.beginPath()
  ctx.arc(90, 124, 24, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = `rgba(${35 + Math.floor(rng() * 40)}, ${26 + Math.floor(rng() * 30)}, ${22 + Math.floor(rng() * 30)}, 0.95)`
  ctx.beginPath()
  ctx.moveTo(67, 120)
  ctx.quadraticCurveTo(90, 70 + rng() * 12, 113, 120)
  ctx.lineTo(113, 106)
  ctx.quadraticCurveTo(90, 56 + rng() * 8, 67, 106)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
  ctx.lineWidth = 2
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function createLazarusTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 320
  const ctx = canvas.getContext('2d')

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#8f8f90'
  ctx.font = '700 148px "Avenir Next", "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('LAZARUS', canvas.width * 0.5, 138)

  ctx.strokeStyle = '#8f8f90'
  ctx.lineWidth = 10
  ctx.beginPath()
  ctx.arc(canvas.width * 0.5, 230, 38, Math.PI * 0.15, Math.PI * 0.85, false)
  ctx.stroke()

  ctx.fillStyle = '#8f8f90'
  ctx.beginPath()
  ctx.moveTo(canvas.width * 0.5 - 54, 226)
  ctx.lineTo(canvas.width * 0.5 + 54, 226)
  ctx.lineTo(canvas.width * 0.5, 272)
  ctx.closePath()
  ctx.fill()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function createMonitorTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 560
  const ctx = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return { canvas, ctx, texture }
}

function drawMonitorFrame(ctx, canvas, elapsed) {
  ctx.fillStyle = '#060f1c'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const centerA = {
    x: canvas.width * (0.32 + Math.sin(elapsed * 0.27) * 0.08),
    y: canvas.height * (0.45 + Math.cos(elapsed * 0.19) * 0.12),
  }
  const centerB = {
    x: canvas.width * (0.67 + Math.cos(elapsed * 0.33) * 0.06),
    y: canvas.height * (0.53 + Math.sin(elapsed * 0.24) * 0.1),
  }

  const haloA = ctx.createRadialGradient(centerA.x, centerA.y, 14, centerA.x, centerA.y, 210)
  haloA.addColorStop(0, 'rgba(255, 175, 214, 0.9)')
  haloA.addColorStop(0.35, 'rgba(208, 125, 221, 0.55)')
  haloA.addColorStop(1, 'rgba(28, 46, 95, 0)')
  ctx.fillStyle = haloA
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const haloB = ctx.createRadialGradient(centerB.x, centerB.y, 10, centerB.x, centerB.y, 180)
  haloB.addColorStop(0, 'rgba(242, 167, 202, 0.88)')
  haloB.addColorStop(0.3, 'rgba(182, 101, 209, 0.52)')
  haloB.addColorStop(1, 'rgba(18, 26, 70, 0)')
  ctx.fillStyle = haloB
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.strokeStyle = 'rgba(194, 236, 255, 0.16)'
  ctx.lineWidth = 1.6
  for (let i = 0; i < 56; i += 1) {
    const y = (i / 56) * canvas.height + Math.sin(elapsed * 1.8 + i * 0.35) * 1.3
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(canvas.width, y)
    ctx.stroke()
  }

  const starCount = 170
  for (let i = 0; i < starCount; i += 1) {
    const angle = i * 13.173
    const x = ((Math.sin(angle) + 1) * 0.5) * canvas.width
    const y = ((Math.cos(angle * 1.29) + 1) * 0.5) * canvas.height
    const twinkle = 0.22 + Math.abs(Math.sin(elapsed * 2.5 + i * 0.4)) * 0.6
    ctx.fillStyle = `rgba(215, 235, 255, ${twinkle})`
    ctx.fillRect(x, y, 1.4, 1.4)
  }
}

function createChair() {
  const chair = new THREE.Group()

  const leatherMaterial = new THREE.MeshStandardMaterial({
    color: 0x15171b,
    roughness: 0.65,
    metalness: 0.1,
  })
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x8d9299,
    roughness: 0.32,
    metalness: 0.85,
  })

  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.16, 1.36), leatherMaterial)
  seat.position.set(0, 0.98, 0)
  chair.add(seat)

  const back = new THREE.Mesh(new THREE.BoxGeometry(1.28, 1.62, 0.15), leatherMaterial)
  back.position.set(0, 1.73, -0.58)
  chair.add(back)

  const backBorder = new THREE.Mesh(new THREE.BoxGeometry(1.34, 1.7, 0.05), frameMaterial)
  backBorder.position.set(0, 1.73, -0.67)
  chair.add(backBorder)

  const armLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 12), frameMaterial)
  armLeft.rotation.x = Math.PI * 0.5
  armLeft.position.set(-0.73, 1.33, 0.08)
  chair.add(armLeft)

  const armRight = armLeft.clone()
  armRight.position.x = 0.73
  chair.add(armRight)

  const supportLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.58, 10), frameMaterial)
  supportLeft.position.set(-0.68, 1.05, 0.05)
  chair.add(supportLeft)

  const supportRight = supportLeft.clone()
  supportRight.position.x = 0.68
  chair.add(supportRight)

  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.44, 16), frameMaterial)
  column.position.set(0, 0.56, 0)
  chair.add(column)

  const wheelHub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.07, 12), frameMaterial)
  wheelHub.position.set(0, 0.28, 0)
  chair.add(wheelHub)

  const casterGeometry = new THREE.SphereGeometry(0.08, 8, 8)
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.045, 0.07), frameMaterial)
    arm.position.set(Math.cos(angle) * 0.36, 0.19, Math.sin(angle) * 0.36)
    arm.rotation.y = angle
    chair.add(arm)

    const caster = new THREE.Mesh(casterGeometry, frameMaterial)
    caster.position.set(Math.cos(angle) * 0.64, 0.08, Math.sin(angle) * 0.64)
    chair.add(caster)
  }

  return chair
}

function createSeatedScientist({ jacketColor, shirtColor, skinColor, hairColor }) {
  const figure = new THREE.Group()

  const jacketMaterial = new THREE.MeshStandardMaterial({
    color: jacketColor,
    roughness: 0.75,
    metalness: 0.05,
  })
  const shirtMaterial = new THREE.MeshStandardMaterial({
    color: shirtColor,
    roughness: 0.68,
    metalness: 0.03,
  })
  const skinMaterial = new THREE.MeshStandardMaterial({
    color: skinColor,
    roughness: 0.72,
    metalness: 0.02,
  })
  const hairMaterial = new THREE.MeshStandardMaterial({
    color: hairColor,
    roughness: 0.75,
    metalness: 0.08,
  })

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.28, 0.52), jacketMaterial)
  torso.position.set(0, 1.9, -0.1)
  figure.add(torso)

  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.26, 0.56), jacketMaterial)
  shoulders.position.set(0, 2.53, -0.12)
  figure.add(shoulders)

  const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.72, 0.57), shirtMaterial)
  shirt.position.set(0, 1.95, 0.03)
  figure.add(shirt)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.31, 16, 16), skinMaterial)
  head.position.set(0, 2.77, -0.18)
  figure.add(head)

  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.33, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.68), hairMaterial)
  hairCap.position.set(0, 2.9, -0.2)
  figure.add(hairCap)

  const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 14), hairMaterial)
  hairBack.scale.set(1.1, 0.78, 0.58)
  hairBack.position.set(0, 2.79, -0.33)
  figure.add(hairBack)

  const hairSideLeft = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 10), hairMaterial)
  hairSideLeft.position.set(-0.23, 2.74, -0.2)
  figure.add(hairSideLeft)

  const hairSideRight = hairSideLeft.clone()
  hairSideRight.position.x = 0.23
  figure.add(hairSideRight)

  const trouserColor = new THREE.Color(jacketColor).multiplyScalar(0.72)
  const trouserMaterial = new THREE.MeshStandardMaterial({
    color: trouserColor,
    roughness: 0.78,
    metalness: 0.03,
  })

  const thighLeft = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.64, 4, 8), trouserMaterial)
  thighLeft.position.set(-0.2, 1.13, 0.25)
  thighLeft.rotation.x = Math.PI * 0.5
  thighLeft.rotation.z = Math.PI * 0.04
  figure.add(thighLeft)

  const thighRight = thighLeft.clone()
  thighRight.position.x = 0.2
  thighRight.rotation.z = -Math.PI * 0.04
  figure.add(thighRight)

  const kneeLeft = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), trouserMaterial)
  kneeLeft.position.set(-0.2, 1.11, 0.76)
  figure.add(kneeLeft)

  const kneeRight = kneeLeft.clone()
  kneeRight.position.x = 0.2
  figure.add(kneeRight)

  const shinLeft = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.78, 4, 8), trouserMaterial)
  shinLeft.position.set(-0.2, 0.62, 0.76)
  figure.add(shinLeft)

  const shinRight = shinLeft.clone()
  shinRight.position.x = 0.2
  figure.add(shinRight)

  const shoeMaterial = new THREE.MeshStandardMaterial({
    color: 0x161718,
    roughness: 0.62,
    metalness: 0.08,
  })

  const shoeLeft = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.46), shoeMaterial)
  shoeLeft.position.set(-0.2, 0.09, 0.99)
  figure.add(shoeLeft)

  const shoeRight = shoeLeft.clone()
  shoeRight.position.x = 0.2
  figure.add(shoeRight)

  const armLeft = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.62, 4, 8), jacketMaterial)
  armLeft.rotation.z = -Math.PI * 0.21
  armLeft.rotation.x = Math.PI * 0.08
  armLeft.position.set(-0.57, 2.3, -0.05)
  figure.add(armLeft)

  const armRight = armLeft.clone()
  armRight.position.x = 0.57
  armRight.rotation.z = Math.PI * 0.21
  figure.add(armRight)

  return figure
}

function createStandingProfessor() {
  const figure = new THREE.Group()

  const trousersMaterial = new THREE.MeshStandardMaterial({
    color: 0xb7b0a8,
    roughness: 0.85,
    metalness: 0.03,
  })
  const shirtMaterial = new THREE.MeshStandardMaterial({
    color: 0x86a8bb,
    roughness: 0.72,
    metalness: 0.02,
  })
  const skinMaterial = new THREE.MeshStandardMaterial({
    color: 0xd3b296,
    roughness: 0.72,
    metalness: 0.02,
  })
  const hairMaterial = new THREE.MeshStandardMaterial({
    color: 0x8e7d68,
    roughness: 0.8,
    metalness: 0.05,
  })

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.5, 0.52), shirtMaterial)
  torso.position.set(0, 3.35, 0)
  figure.add(torso)

  const legLeft = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 1.1, 4, 10), trousersMaterial)
  legLeft.position.set(-0.2, 2.05, 0)
  figure.add(legLeft)

  const legRight = legLeft.clone()
  legRight.position.x = 0.2
  figure.add(legRight)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), skinMaterial)
  head.position.set(0, 4.35, -0.06)
  figure.add(head)

  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.67), hairMaterial)
  hairCap.position.set(0, 4.5, -0.08)
  figure.add(hairCap)

  const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 14), hairMaterial)
  hairBack.position.set(0, 4.34, -0.26)
  hairBack.scale.set(1.08, 0.74, 0.55)
  figure.add(hairBack)

  const hairSideLeft = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), hairMaterial)
  hairSideLeft.position.set(-0.24, 4.32, -0.09)
  figure.add(hairSideLeft)

  const hairSideRight = hairSideLeft.clone()
  hairSideRight.position.x = 0.24
  figure.add(hairSideRight)

  const armLeft = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 1.04, 4, 8), shirtMaterial)
  armLeft.position.set(-0.56, 3.5, -0.02)
  armLeft.rotation.z = -Math.PI * 0.12
  armLeft.rotation.y = Math.PI * 0.08
  figure.add(armLeft)

  const armRight = armLeft.clone()
  armRight.position.x = 0.56
  armRight.rotation.z = Math.PI * 0.12
  armRight.rotation.y = -Math.PI * 0.08
  figure.add(armRight)

  return figure
}

const NasaFacilityScene = {
  id: 'nasa-facility-reveal',
  title: 'Secret NASA Facility Reveal',
  create() {
    const state = {
      group: null,
      root: null,
      scene: null,
      previousBackground: null,
      previousFog: null,
      fluorescents: [],
      dust: null,
      monitor: null,
      monitorLight: null,
      timeOffset: Math.PI * 0.25,
    }

    return {
      init({ root, camera, scene }) {
        state.root = root
        state.scene = scene
        state.previousBackground = scene.background
        state.previousFog = scene.fog

        scene.background = new THREE.Color(0x0e0a08)
        scene.fog = new THREE.Fog(0x19110e, 34, 105)

        camera.position.set(6, 3.45, 9)
        camera.lookAt(2.5, 2.2, -2.6)
        clampCameraToNasaRoom(camera)

        const room = new THREE.Group()
        room.name = 'nasa-meeting-room'
        root.add(room)
        state.group = room

        const carpetTexture = createCarpetTexture()
        const floorMaterial = new THREE.MeshStandardMaterial({
          color: 0x8f8f96,
          map: carpetTexture,
          roughness: 0.96,
          metalness: 0.02,
        })
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH), floorMaterial)
        floor.rotation.x = -Math.PI * 0.5
        room.add(floor)

        const ceilingMaterial = new THREE.MeshStandardMaterial({
          color: 0x2e2b2d,
          roughness: 0.84,
          metalness: 0.08,
        })
        const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH), ceilingMaterial)
        ceiling.position.y = ROOM_HEIGHT
        ceiling.rotation.x = Math.PI * 0.5
        room.add(ceiling)

        const woodTexture = createWoodPanelTexture()
        const woodWallMaterial = new THREE.MeshStandardMaterial({
          color: 0x93583a,
          map: woodTexture,
          emissive: 0x221109,
          emissiveIntensity: 0.08,
          roughness: 0.62,
          metalness: 0.06,
        })
        const upperWallMaterial = new THREE.MeshStandardMaterial({
          color: 0xddd1c5,
          roughness: 0.88,
          metalness: 0.02,
        })
        const trimMaterial = new THREE.MeshStandardMaterial({
          color: 0x3b2114,
          roughness: 0.68,
          metalness: 0.12,
        })

        const panelHeight = 7
        const upperHeight = ROOM_HEIGHT - panelHeight

        const frontPanel = new THREE.Mesh(new THREE.BoxGeometry(ROOM_WIDTH, panelHeight, WALL_THICKNESS), woodWallMaterial)
        frontPanel.position.set(0, panelHeight * 0.5, -ROOM_DEPTH * 0.5)
        room.add(frontPanel)

        const frontUpper = new THREE.Mesh(new THREE.BoxGeometry(ROOM_WIDTH, upperHeight, WALL_THICKNESS), upperWallMaterial)
        frontUpper.position.set(0, panelHeight + upperHeight * 0.5, -ROOM_DEPTH * 0.5 + 0.02)
        room.add(frontUpper)

        const backPanel = new THREE.Mesh(new THREE.BoxGeometry(ROOM_WIDTH, panelHeight, WALL_THICKNESS), woodWallMaterial)
        backPanel.position.set(0, panelHeight * 0.5, ROOM_DEPTH * 0.5)
        room.add(backPanel)

        const backUpper = new THREE.Mesh(new THREE.BoxGeometry(ROOM_WIDTH, upperHeight, WALL_THICKNESS), upperWallMaterial)
        backUpper.position.set(0, panelHeight + upperHeight * 0.5, ROOM_DEPTH * 0.5 - 0.02)
        room.add(backUpper)

        const sidePanelGeometry = new THREE.BoxGeometry(WALL_THICKNESS, panelHeight, ROOM_DEPTH)
        const sideUpperGeometry = new THREE.BoxGeometry(WALL_THICKNESS, upperHeight, ROOM_DEPTH)

        const leftPanel = new THREE.Mesh(sidePanelGeometry, woodWallMaterial)
        leftPanel.position.set(-ROOM_WIDTH * 0.5, panelHeight * 0.5, 0)
        room.add(leftPanel)

        const rightPanel = new THREE.Mesh(sidePanelGeometry, woodWallMaterial)
        rightPanel.position.set(ROOM_WIDTH * 0.5, panelHeight * 0.5, 0)
        room.add(rightPanel)

        const leftUpper = new THREE.Mesh(sideUpperGeometry, upperWallMaterial)
        leftUpper.position.set(-ROOM_WIDTH * 0.5 + 0.02, panelHeight + upperHeight * 0.5, 0)
        room.add(leftUpper)

        const rightUpper = new THREE.Mesh(sideUpperGeometry, upperWallMaterial)
        rightUpper.position.set(ROOM_WIDTH * 0.5 - 0.02, panelHeight + upperHeight * 0.5, 0)
        room.add(rightUpper)

        for (let i = 0; i < 12; i += 1) {
          const trim = new THREE.Mesh(new THREE.BoxGeometry(0.06, panelHeight, WALL_THICKNESS + 0.02), trimMaterial)
          trim.position.set(-ROOM_WIDTH * 0.5 + i * 3.3 + 1.4, panelHeight * 0.5, -ROOM_DEPTH * 0.5 + 0.02)
          room.add(trim)
        }

        const roomAmbient = new THREE.AmbientLight(0xd6b695, 1.05)
        room.add(roomAmbient)

        const keyLight = new THREE.DirectionalLight(0xffe5c8, 1.02)
        keyLight.position.set(7.5, ROOM_HEIGHT - 0.8, 5.8)
        room.add(keyLight)

        const fillLight = new THREE.DirectionalLight(0xdeb998, 0.52)
        fillLight.position.set(-8, 4.2, -7.2)
        room.add(fillLight)

        const frontWallBounce = new THREE.PointLight(0xf7c79e, 1.35, 34, 1.6)
        frontWallBounce.position.set(0, 5.2, -11.1)
        room.add(frontWallBounce)

        const backWallBounce = new THREE.PointLight(0xe9bb94, 1.0, 32, 1.75)
        backWallBounce.position.set(0, 4.1, 10.5)
        room.add(backWallBounce)

        const stripPositions = [
          [-12.5, -10.8],
          [-6.8, -10.6],
          [-0.2, -10.3],
          [6.8, -10.5],
          [13.4, -10.6],
          [-3.2, -6.5],
          [3.1, -6.3],
          [10.2, -6.8],
          [-9.6, -3.2],
          [-2.1, -2.7],
          [5.8, -2.1],
          [13.1, -1.4],
        ]

        for (let i = 0; i < stripPositions.length; i += 1) {
          const [x, z] = stripPositions[i]
          const housingMaterial = new THREE.MeshStandardMaterial({
            color: 0xf4f1e9,
            emissive: 0xfff2cf,
            emissiveIntensity: 1.35,
            roughness: 0.4,
            metalness: 0.05,
          })
          const lightHousing = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.14, 0.88), housingMaterial)
          lightHousing.position.set(x, ROOM_HEIGHT - 0.1, z)
          room.add(lightHousing)

          // Primary emitters from each ceiling panel.
          const tubeLight = new THREE.PointLight(0xffefd1, 2.95, 36, 1.45)
          tubeLight.position.set(x, ROOM_HEIGHT - 0.42, z)
          room.add(tubeLight)

          const panelBoostLight = new THREE.PointLight(0xffe2b8, 2.15, 24, 1.7)
          panelBoostLight.position.set(x, ROOM_HEIGHT - 0.9, z)
          room.add(panelBoostLight)

          state.fluorescents.push({
            baseIntensity: 2.78 + (i % 3) * 0.18,
            baseBoostIntensity: 2.02 + (i % 3) * 0.16,
            baseEmissive: 1.3 + (i % 3) * 0.08,
            light: tubeLight,
            boostLight: panelBoostLight,
            material: housingMaterial,
            phase: i * 0.87,
          })
        }

        const tableGroup = new THREE.Group()
        tableGroup.position.set(1.4, 0, -0.85)
        room.add(tableGroup)

        const tableMaterial = new THREE.MeshStandardMaterial({
          color: 0x85401e,
          roughness: 0.38,
          metalness: 0.18,
        })
        const tableEdgeMaterial = new THREE.MeshStandardMaterial({
          color: 0x5d2b15,
          roughness: 0.42,
          metalness: 0.14,
        })

        const tableTop = new THREE.Mesh(new THREE.BoxGeometry(13.4, 0.3, 4.7), tableMaterial)
        tableTop.position.set(0, 1.2, 0)
        tableGroup.add(tableTop)

        const tableEdge = new THREE.Mesh(new THREE.BoxGeometry(13.2, 0.12, 4.4), tableEdgeMaterial)
        tableEdge.position.set(0, 1.03, 0)
        tableGroup.add(tableEdge)

        const legMaterial = new THREE.MeshStandardMaterial({
          color: 0x1e1d20,
          roughness: 0.58,
          metalness: 0.22,
        })
        const legOffsets = [
          [-4.8, -1.45],
          [4.8, -1.45],
          [-4.8, 1.45],
          [4.8, 1.45],
        ]
        for (const [x, z] of legOffsets) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.66, 1.02, 0.66), legMaterial)
          leg.position.set(x, 0.52, z)
          tableGroup.add(leg)
        }

        const paperMaterial = new THREE.MeshStandardMaterial({
          color: 0xe3ddd2,
          roughness: 0.93,
          metalness: 0,
        })
        const binderMaterial = new THREE.MeshStandardMaterial({
          color: 0x4f5966,
          roughness: 0.82,
          metalness: 0.1,
        })
        const paperConfigs = [
          { x: -2.4, z: -1.3, r: 0.08 },
          { x: 2.8, z: -1.1, r: -0.11 },
          { x: -0.7, z: 0.9, r: 0.04 },
          { x: 4.2, z: 1.3, r: -0.07 },
        ]
        for (const config of paperConfigs) {
          const paperStack = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.03, 0.88), paperMaterial)
          paperStack.position.set(config.x, 1.36, config.z)
          paperStack.rotation.y = config.r
          tableGroup.add(paperStack)
        }

        const binder = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.11, 0.92), binderMaterial)
        binder.position.set(-5.3, 1.39, -0.1)
        binder.rotation.y = 0.2
        tableGroup.add(binder)

        const tableCenter = new THREE.Vector3(tableGroup.position.x, 0, tableGroup.position.z)
        const chairLayout = [
          [-4.9, -4.32, 0.02],
          [-1.65, -4.36, -0.03],
          [1.65, -4.32, 0],
          [4.92, -4.26, 0.04],
          [-4.85, 4.3, Math.PI - 0.03],
          [-1.6, 4.35, Math.PI + 0.02],
          [1.62, 4.35, Math.PI - 0.05],
          [4.88, 4.26, Math.PI + 0.04],
          [-9.35, 0.05, Math.PI * 0.5 + 0.08],
          [9.4, -0.1, -Math.PI * 0.5 - 0.05],
        ]
        const chairAnchors = []
        for (let i = 0; i < chairLayout.length; i += 1) {
          const [x, z, rotation] = chairLayout[i]
          const chair = createChair()
          chair.position.set(tableCenter.x + x, 0, tableCenter.z + z)
          chair.rotation.y = rotation
          room.add(chair)
          chairAnchors.push(chair)
        }

        const scientistConfigs = [
          { anchor: 0, jacketColor: 0x1f232b, shirtColor: 0xddd9cf, skinColor: 0xc59a79, hairColor: 0x2f2f2f },
          { anchor: 3, jacketColor: 0x3d302a, shirtColor: 0xcfcdc6, skinColor: 0xd1ab84, hairColor: 0x4f352a },
          { anchor: 4, jacketColor: 0x4b3d34, shirtColor: 0xd5d4cf, skinColor: 0x8a644f, hairColor: 0x2d1e1a },
          { anchor: 7, jacketColor: 0x253447, shirtColor: 0xd0d4db, skinColor: 0xbd9573, hairColor: 0x2b2c2d },
          { anchor: 8, jacketColor: 0x191a1d, shirtColor: 0xcfd4d6, skinColor: 0xa87b5f, hairColor: 0x1f1f21 },
        ]

        for (const config of scientistConfigs) {
          const figure = createSeatedScientist(config)
          figure.position.copy(chairAnchors[config.anchor].position)
          figure.rotation.y = chairAnchors[config.anchor].rotation.y
          room.add(figure)
        }

        const standingProfessor = createStandingProfessor()
        standingProfessor.position.set(-3, -1.38, -9)
        standingProfessor.rotation.y = 0.5
        room.add(standingProfessor)

        const portraitPositions = [-15.4, -12.2, -9.1, -5.9, -2.8, 2.8, 5.9, 9.1, 12.2, 15.4]
        for (let i = 0; i < portraitPositions.length; i += 1) {
          const portraitGroup = new THREE.Group()
          portraitGroup.position.set(portraitPositions[i], 5.66, -ROOM_DEPTH * 0.5 + 0.26)
          room.add(portraitGroup)

          const frameOuter = new THREE.Mesh(
            new THREE.BoxGeometry(1.28, 1.58, 0.1),
            new THREE.MeshStandardMaterial({
              color: 0x0f1011,
              roughness: 0.54,
              metalness: 0.28,
            }),
          )
          portraitGroup.add(frameOuter)

          const frameInner = new THREE.Mesh(
            new THREE.BoxGeometry(0.92, 1.2, 0.05),
            new THREE.MeshStandardMaterial({
              color: 0xe5e2d9,
              roughness: 0.92,
              metalness: 0.02,
            }),
          )
          frameInner.position.z = 0.05
          portraitGroup.add(frameInner)

          const portraitTexture = createPortraitTexture(i)
          const portrait = new THREE.Mesh(
            new THREE.PlaneGeometry(0.66, 0.88),
            new THREE.MeshStandardMaterial({
              map: portraitTexture,
              roughness: 0.82,
              metalness: 0.02,
            }),
          )
          portrait.position.z = 0.09
          portraitGroup.add(portrait)
        }

        const lazarusTexture = createLazarusTexture()
        const lazarusSign = new THREE.Mesh(
          new THREE.PlaneGeometry(6.2, 1.95),
          new THREE.MeshStandardMaterial({
            map: lazarusTexture,
            transparent: true,
            roughness: 0.88,
            metalness: 0.04,
          }),
        )
        lazarusSign.position.set(0, 6.0, -ROOM_DEPTH * 0.5 + 0.25)
        room.add(lazarusSign)

        const sculptureBaseMaterial = new THREE.MeshStandardMaterial({
          color: 0x2a2a2d,
          roughness: 0.5,
          metalness: 0.36,
        })
        const sculptureMetalMaterial = new THREE.MeshStandardMaterial({
          color: 0x303034,
          roughness: 0.42,
          metalness: 0.62,
        })

        const sculptureX = 0
        const sculptureZ = -12.45

        const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.9, 3.2, 20), sculptureBaseMaterial)
        pedestal.position.set(sculptureX, 1.6, sculptureZ)
        room.add(pedestal)

        const statueCore = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.24, 14), sculptureMetalMaterial)
        statueCore.position.set(sculptureX, 3.6, sculptureZ)
        room.add(statueCore)

        const wingLeft = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.06, 12, 40, Math.PI * 0.78), sculptureMetalMaterial)
        wingLeft.position.set(sculptureX - 0.31, 3.92, sculptureZ + 0.04)
        wingLeft.rotation.set(Math.PI * 0.56, -Math.PI * 0.05, Math.PI * 0.28)
        room.add(wingLeft)

        const wingRight = wingLeft.clone()
        wingRight.position.x = sculptureX + 0.31
        wingRight.rotation.z = -Math.PI * 0.28
        room.add(wingRight)

        const monitorData = createMonitorTexture()
        drawMonitorFrame(monitorData.ctx, monitorData.canvas, 0)
        monitorData.texture.needsUpdate = true
        state.monitor = monitorData

        const monitorGroup = new THREE.Group()
        monitorGroup.position.set(ROOM_WIDTH * 0.5 - 0.28, 4.5, -1.5)
        monitorGroup.rotation.y = -Math.PI * 0.5
        room.add(monitorGroup)

        const monitorFrame = new THREE.Mesh(
          new THREE.BoxGeometry(5.75, 3.55, 0.18),
          new THREE.MeshStandardMaterial({
            color: 0x121316,
            roughness: 0.42,
            metalness: 0.6,
          }),
        )
        monitorGroup.add(monitorFrame)

        const monitorScreen = new THREE.Mesh(
          new THREE.PlaneGeometry(5.28, 3.04),
          new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: monitorData.texture,
            emissive: 0x78a5d8,
            emissiveIntensity: 0.86,
            roughness: 0.36,
            metalness: 0.08,
          }),
        )
        monitorScreen.position.z = 0.11
        monitorGroup.add(monitorScreen)

        const monitorStand = new THREE.Mesh(
          new THREE.CylinderGeometry(0.17, 0.22, 2.8, 12),
          new THREE.MeshStandardMaterial({
            color: 0x494f57,
            roughness: 0.36,
            metalness: 0.76,
          }),
        )
        monitorStand.position.set(0, -3.08, -0.02)
        monitorGroup.add(monitorStand)

        const monitorFoot = new THREE.Mesh(
          new THREE.CylinderGeometry(0.65, 0.82, 0.22, 20),
          new THREE.MeshStandardMaterial({
            color: 0x262a31,
            roughness: 0.42,
            metalness: 0.66,
          }),
        )
        monitorFoot.position.set(0, -4.55, -0.02)
        monitorGroup.add(monitorFoot)

        const monitorGlow = new THREE.PointLight(0xaab9c9, 0.24, 10, 2)
        monitorGlow.position.set(ROOM_WIDTH * 0.5 - 1.9, 4.38, -1.5)
        room.add(monitorGlow)
        state.monitorLight = monitorGlow

        const stackedChairBottom = createChair()
        stackedChairBottom.position.set(-17, 0.02, 3.8)
        stackedChairBottom.rotation.y = Math.PI * 0.5
        room.add(stackedChairBottom)

        const stackedChairTop = createChair()
        stackedChairTop.scale.set(0.95, 0.95, 0.95)
        stackedChairTop.position.set(-17.02, 1.16, 3.8)
        stackedChairTop.rotation.y = Math.PI * 0.5
        room.add(stackedChairTop)

        const dustCount = 680
        const dustPositions = new Float32Array(dustCount * 3)
        const rng = createRng(904)
        for (let i = 0; i < dustCount; i += 1) {
          const index = i * 3
          dustPositions[index] = (rng() - 0.5) * (ROOM_WIDTH - 2.4)
          dustPositions[index + 1] = 0.6 + rng() * (ROOM_HEIGHT - 1.3)
          dustPositions[index + 2] = (rng() - 0.5) * (ROOM_DEPTH - 2)
        }
        const dustGeometry = new THREE.BufferGeometry()
        dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
        const dustMaterial = new THREE.PointsMaterial({
          color: 0xe3d8c8,
          size: 0.055,
          transparent: true,
          opacity: 0.26,
          depthWrite: false,
          sizeAttenuation: true,
        })
        const dust = new THREE.Points(dustGeometry, dustMaterial)
        dust.position.y = 0.15
        room.add(dust)
        state.dust = dust
      },

      update({ delta, elapsed, camera }) {
        if (!state.group) {
          return
        }

        clampCameraToNasaRoom(camera)

        for (const strip of state.fluorescents) {
          const baseWave = 0.985 + Math.sin(elapsed * 0.62 + strip.phase + state.timeOffset) * 0.025
          const fastFlicker = Math.sin(elapsed * 9 + strip.phase * 1.6) * 0.004
          const intensityScale = baseWave + fastFlicker
          strip.light.intensity = strip.baseIntensity * intensityScale
          strip.boostLight.intensity = strip.baseBoostIntensity * intensityScale
          strip.material.emissiveIntensity = strip.baseEmissive * intensityScale
        }

        if (state.monitor) {
          drawMonitorFrame(state.monitor.ctx, state.monitor.canvas, elapsed)
          state.monitor.texture.needsUpdate = true
        }

        if (state.monitorLight) {
          state.monitorLight.intensity = 0.22 + Math.sin(elapsed * 2.2) * 0.04
        }

        if (state.dust) {
          state.dust.rotation.y += delta * 0.028
          state.dust.position.y = 0.15 + Math.sin(elapsed * 0.26) * 0.06
          state.dust.material.opacity = 0.24 + Math.sin(elapsed * 0.8) * 0.04
        }
      },

      resize() {},

      dispose() {
        if (state.scene) {
          state.scene.background = state.previousBackground
          state.scene.fog = state.previousFog
        }

        if (state.group) {
          if (state.root && state.group.parent !== state.root) {
            state.root.add(state.group)
          }
          disposeObject3D(state.group)
        }

        state.group = null
        state.root = null
        state.scene = null
        state.previousBackground = null
        state.previousFog = null
        state.fluorescents.length = 0
        state.dust = null
        state.monitor = null
        state.monitorLight = null
      },
    }
  },
}

export default NasaFacilityScene
