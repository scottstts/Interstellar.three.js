import * as THREE from 'three/webgpu'
import { SkyMesh } from 'three/addons/objects/SkyMesh.js'
import { disposeObject3D } from '../utils/dispose'

const SCENE_ID = 'cooper-farmhouse-intro'
const SCENE_TITLE = 'Cooper Farmhouse and Cornfield Intro'
const TAU = Math.PI * 2
const FARMHOUSE_CAMERA_GROUND_CLEARANCE = 0.7
const FARMHOUSE_ROAD_HALF_WIDTH = 5.9
const FARMHOUSE_ROAD_Z_MIN = -196
const FARMHOUSE_ROAD_Z_MAX = 28
const INSTANCE_DUMMY = new THREE.Object3D()
const TEMP_FORWARD = new THREE.Vector3()
const TEMP_SIDE = new THREE.Vector3()
const TEMP_REAR = new THREE.Vector3()

function createSeededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 4294967296
  }
}

function getFarmhouseTerrainHeightAt(x, z) {
  const roadCenter = Math.sin(z * 0.055) * 1.55
  const roadReach = Math.max(0, 1 - Math.abs(z + 84) / 290)
  const roadCut = Math.exp(-Math.pow((x - roadCenter) / 8.1, 2)) * 0.34 * roadReach
  const rolling = Math.sin((x + 28) * 0.024) * 0.68 + Math.cos((z - 36) * 0.019) * 0.54
  const macro = Math.sin((x - 170) * 0.0048) * 0.34 + Math.cos((z + 120) * 0.0052) * 0.32
  const furrows = Math.sin((x * 0.9 + z * 0.24) * 0.14) * 0.1
  return rolling + macro + furrows - roadCut - 0.45
}

function getFarmhouseRoadHeightAt(x, z) {
  if (z < FARMHOUSE_ROAD_Z_MIN || z > FARMHOUSE_ROAD_Z_MAX) {
    return -Infinity
  }

  const meander = Math.sin(z * 0.055) * 1.55
  const localX = x - meander
  if (Math.abs(localX) > FARMHOUSE_ROAD_HALF_WIDTH) {
    return -Infinity
  }

  const crown = Math.cos(localX * 0.7) * 0.06
  const rut = Math.exp(-Math.pow((Math.abs(localX) - 2.05) / 0.55, 2)) * -0.045
  return 0.08 + crown + rut
}

function clampCameraToFarmhouseGround(camera) {
  if (!camera) {
    return
  }

  const x = camera.position.x
  const z = camera.position.z
  const terrainY = getFarmhouseTerrainHeightAt(x, z)
  const roadY = getFarmhouseRoadHeightAt(x, z)
  const surfaceY = Math.max(terrainY, roadY)
  const minimumY = surfaceY + FARMHOUSE_CAMERA_GROUND_CLEARANCE

  if (camera.position.y < minimumY) {
    camera.position.y = minimumY
    camera.updateMatrixWorld()
  }
}

function createCanvasTexture(size, drawFn) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Could not create canvas context for procedural scene texture.')
  }

  drawFn(context, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.needsUpdate = true

  return texture
}

function createGroundTexture(rng) {
  const texture = createCanvasTexture(512, (context, size) => {
    context.fillStyle = '#8f7652'
    context.fillRect(0, 0, size, size)

    for (let i = 0; i < 42000; i += 1) {
      const x = Math.floor(rng() * size)
      const y = Math.floor(rng() * size)
      const dark = 92 + Math.floor(rng() * 58)
      const alpha = 0.03 + rng() * 0.13
      context.fillStyle = `rgba(${dark}, ${66 + Math.floor(rng() * 24)}, ${42 + Math.floor(rng() * 20)}, ${alpha})`
      context.fillRect(x, y, 1, 1)
    }

    context.globalAlpha = 0.16
    context.strokeStyle = '#705737'
    context.lineWidth = 1
    for (let i = 0; i < 120; i += 1) {
      const y = (i / 120) * size
      context.beginPath()
      context.moveTo(0, y + Math.sin(i * 0.53) * 5.5)
      context.bezierCurveTo(size * 0.24, y + 7, size * 0.62, y - 7, size, y + Math.cos(i * 0.7) * 6)
      context.stroke()
    }
    context.globalAlpha = 1
  })

  texture.repeat.set(86, 86)
  return texture
}

function createRoadTexture(rng) {
  const texture = createCanvasTexture(512, (context, size) => {
    context.fillStyle = '#7a5f43'
    context.fillRect(0, 0, size, size)

    for (let i = 0; i < 28000; i += 1) {
      const x = Math.floor(rng() * size)
      const y = Math.floor(rng() * size)
      const shade = 84 + Math.floor(rng() * 44)
      const alpha = 0.05 + rng() * 0.15
      context.fillStyle = `rgba(${shade}, ${56 + Math.floor(rng() * 18)}, ${38 + Math.floor(rng() * 16)}, ${alpha})`
      context.fillRect(x, y, 1, 1)
    }

    context.fillStyle = 'rgba(62, 48, 36, 0.5)'
    context.fillRect(size * 0.29, 0, size * 0.11, size)
    context.fillRect(size * 0.61, 0, size * 0.11, size)

    context.strokeStyle = 'rgba(188, 153, 108, 0.3)'
    context.lineWidth = 2
    for (let i = 0; i < 35; i += 1) {
      const y = (i / 35) * size
      context.beginPath()
      context.moveTo(size * 0.22, y)
      context.lineTo(size * 0.76, y + (rng() - 0.5) * 8)
      context.stroke()
    }
  })

  texture.repeat.set(1, 8)
  return texture
}

const FARMHOUSE_SKY_PARAMS = Object.freeze({
  timeOfDay: 15.0,
  turbidity: 10.0,
  rayleigh: 2.0,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.8,
})

function getFarmhouseSunState() {
  const t = (FARMHOUSE_SKY_PARAMS.timeOfDay / 24) * Math.PI * 2
  const elevation = Math.max(-0.05, Math.sin(t - Math.PI / 2))
  const mix = THREE.MathUtils.clamp((elevation + 0.05) / 1.05, 0, 1)
  const phi = THREE.MathUtils.lerp(Math.PI * 0.51, Math.PI * 0.02, mix)
  const theta = t + Math.PI * 0.35
  const sunDirection = new THREE.Vector3().setFromSphericalCoords(1, phi, theta).normalize()
  return { mix, sunDirection }
}

function createSkyBackdrop() {
  const group = new THREE.Group()

  const sky = new SkyMesh()
  sky.scale.setScalar(100000)
  group.add(sky)

  const { mix, sunDirection } = getFarmhouseSunState()

  sky.turbidity.value = FARMHOUSE_SKY_PARAMS.turbidity
  sky.rayleigh.value = FARMHOUSE_SKY_PARAMS.rayleigh
  sky.mieCoefficient.value = FARMHOUSE_SKY_PARAMS.mieCoefficient
  sky.mieDirectionalG.value = FARMHOUSE_SKY_PARAMS.mieDirectionalG
  sky.sunPosition.value.copy(sunDirection)

  const sunDisk = new THREE.Mesh(
    new THREE.SphereGeometry(120, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  )
  sunDisk.position.copy(sunDirection).multiplyScalar(50000)
  const diskBrightness = THREE.MathUtils.lerp(0.0, 1.0, mix)
  sunDisk.visible = diskBrightness > 0.02
  group.add(sunDisk)

  return group
}

function createLightingSet() {
  const group = new THREE.Group()

  const { mix, sunDirection } = getFarmhouseSunState()

  const sunLight = new THREE.DirectionalLight(0xffffff, 6.0)
  sunLight.position.copy(sunDirection).multiplyScalar(200)
  sunLight.target.position.set(0, 0, 0)
  sunLight.target.updateMatrixWorld()

  const warm = new THREE.Color(0xffd1a3)
  const white = new THREE.Color(0xffffff)
  sunLight.color.copy(warm).lerp(white, mix)
  sunLight.intensity = THREE.MathUtils.lerp(0.5, 7.0, Math.pow(mix, 0.7))

  const ambient = new THREE.AmbientLight(0xffffff, 0.03)

  group.add(sunLight, sunLight.target, ambient)
  return group
}

function createTerrain(rng) {
  const group = new THREE.Group()

  const groundTexture = createGroundTexture(rng)
  const roadTexture = createRoadTexture(rng)

  const groundGeometry = new THREE.PlaneGeometry(1800, 1800, 220, 220)
  groundGeometry.rotateX(-Math.PI / 2)
  const groundPositions = groundGeometry.attributes.position

  for (let i = 0; i < groundPositions.count; i += 1) {
    const x = groundPositions.getX(i)
    const z = groundPositions.getZ(i)
    const roadCenter = Math.sin(z * 0.055) * 1.55
    const roadReach = Math.max(0, 1 - Math.abs(z + 84) / 290)
    const roadCut = Math.exp(-Math.pow((x - roadCenter) / 8.1, 2)) * 0.34 * roadReach
    const rolling = Math.sin((x + 28) * 0.024) * 0.68 + Math.cos((z - 36) * 0.019) * 0.54
    const macro = Math.sin((x - 170) * 0.0048) * 0.34 + Math.cos((z + 120) * 0.0052) * 0.32
    const furrows = Math.sin((x * 0.9 + z * 0.24) * 0.14) * 0.1
    const noise = (rng() - 0.5) * 0.1
    groundPositions.setY(i, rolling + macro + furrows + noise - roadCut - 0.45)
  }

  groundPositions.needsUpdate = true
  groundGeometry.computeVertexNormals()

  const ground = new THREE.Mesh(
    groundGeometry,
    new THREE.MeshStandardMaterial({
      color: 0x8f7a55,
      map: groundTexture,
      metalness: 0.03,
      roughness: 0.96,
    }),
  )
  group.add(ground)

  const roadGeometry = new THREE.PlaneGeometry(11.8, 224, 18, 180)
  roadGeometry.rotateX(-Math.PI / 2)
  roadGeometry.translate(0, 0.08, -84)
  const roadPositions = roadGeometry.attributes.position

  for (let i = 0; i < roadPositions.count; i += 1) {
    const z = roadPositions.getZ(i)
    const x = roadPositions.getX(i)
    const meander = Math.sin(z * 0.055) * 1.55
    const crown = Math.cos(x * 0.7) * 0.06
    const rut = Math.exp(-Math.pow((Math.abs(x) - 2.05) / 0.55, 2)) * -0.045
    roadPositions.setX(i, x + meander)
    roadPositions.setY(i, roadPositions.getY(i) + crown + rut)
  }

  roadPositions.needsUpdate = true
  roadGeometry.computeVertexNormals()

  const road = new THREE.Mesh(
    roadGeometry,
    new THREE.MeshStandardMaterial({
      color: 0x755e44,
      map: roadTexture,
      metalness: 0.01,
      roughness: 0.97,
    }),
  )
  group.add(road)

  for (const side of [-1, 1]) {
    const shoulderGeometry = new THREE.PlaneGeometry(2.3, 224, 3, 180)
    shoulderGeometry.rotateX(-Math.PI / 2)
    shoulderGeometry.translate(side * 6.75, 0.04, -84)
    const shoulderPositions = shoulderGeometry.attributes.position

    for (let i = 0; i < shoulderPositions.count; i += 1) {
      const z = shoulderPositions.getZ(i)
      const x = shoulderPositions.getX(i)
      const meander = Math.sin(z * 0.055) * 1.55
      const mound = Math.cos((x + side * 3) * 2.1) * 0.03
      shoulderPositions.setX(i, x + meander)
      shoulderPositions.setY(i, shoulderPositions.getY(i) + mound)
    }

    shoulderPositions.needsUpdate = true
    shoulderGeometry.computeVertexNormals()
    const shoulder = new THREE.Mesh(
      shoulderGeometry,
      new THREE.MeshStandardMaterial({
        color: 0x7e6548,
        metalness: 0.01,
        roughness: 0.95,
      }),
    )
    group.add(shoulder)
  }

  return group
}

function createUtilityPoles() {
  const group = new THREE.Group()

  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x65513c,
    metalness: 0.04,
    roughness: 0.9,
  })
  const wireMaterial = new THREE.MeshBasicMaterial({
    color: 0x2c2621,
    depthWrite: false,
    fog: true,
    transparent: true,
    opacity: 0.8,
  })

  const polePoints = []

  for (let z = 4; z > -180; z -= 19) {
    const x = 12 + Math.sin(z * 0.04) * 0.8

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.27, 9.4, 8), poleMaterial)
    pole.position.set(x, 4.75, z)
    group.add(pole)

    const crossArm = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.14, 0.14), poleMaterial)
    crossArm.position.set(x, 8.3, z)
    group.add(crossArm)

    for (const offset of [-0.9, 0, 0.9]) {
      const insulator = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 10, 10),
        new THREE.MeshStandardMaterial({
          color: 0x96908a,
          metalness: 0.03,
          roughness: 0.76,
        }),
      )
      insulator.position.set(x + offset, 8.2, z)
      group.add(insulator)
    }

    polePoints.push(new THREE.Vector3(x, 8.3, z))
  }

  for (let i = 0; i < 3; i += 1) {
    const offset = -0.82 + i * 0.82
    const points = polePoints.map((point, index) => {
      const t = polePoints.length > 1 ? index / (polePoints.length - 1) : 0
      return new THREE.Vector3(
        point.x + offset,
        point.y - 0.32 - i * 0.12 - Math.sin(t * Math.PI) * 0.42,
        point.z,
      )
    })

    const wire = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.max(points.length * 8, 24), 0.026, 6, false),
      wireMaterial,
    )
    group.add(wire)
  }

  return group
}

function addWindowPanel(parent, config) {
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(config.width, config.height, 0.1),
    config.frameMaterial,
  )
  frame.position.set(config.x, config.y, config.z)
  frame.rotation.y = config.rotationY ?? 0
  parent.add(frame)

  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(config.width * 0.74, config.height * 0.68),
    config.paneMaterial,
  )
  pane.position.set(
    config.x + Math.sin(config.rotationY ?? 0) * 0.055,
    config.y,
    config.z + Math.cos(config.rotationY ?? 0) * 0.055,
  )
  pane.rotation.y = config.rotationY ?? 0
  parent.add(pane)
}

function createFarmstead(rng) {
  const farmstead = new THREE.Group()
  farmstead.position.set(-30, 0, -72)
  farmstead.scale.setScalar(1.08)

  const paintMaterial = new THREE.MeshStandardMaterial({
    color: 0xd2c9bb,
    metalness: 0.02,
    roughness: 0.88,
  })
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: 0x78644e,
    metalness: 0.02,
    roughness: 0.86,
  })
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: 0x6c5a4c,
    metalness: 0.04,
    roughness: 0.93,
  })
  const windowPaneMaterial = new THREE.MeshStandardMaterial({
    color: 0x9aa8b3,
    emissive: 0x6e4d32,
    emissiveIntensity: 0.08,
    metalness: 0,
    roughness: 0.38,
    transparent: true,
    opacity: 0.84,
  })
  const porchMaterial = new THREE.MeshStandardMaterial({
    color: 0x7f694e,
    metalness: 0.01,
    roughness: 0.91,
  })

  const foundation = new THREE.Mesh(new THREE.BoxGeometry(14, 0.75, 10.5), trimMaterial)
  foundation.position.y = 0.35
  farmstead.add(foundation)

  const firstFloor = new THREE.Mesh(new THREE.BoxGeometry(12.5, 4.9, 9.6), paintMaterial)
  firstFloor.position.y = 2.95
  farmstead.add(firstFloor)

  const secondFloor = new THREE.Mesh(new THREE.BoxGeometry(9.1, 3.8, 8.2), paintMaterial)
  secondFloor.position.y = 6.8
  farmstead.add(secondFloor)

  const roofLeft = new THREE.Mesh(new THREE.BoxGeometry(7, 0.34, 10.4), roofMaterial)
  roofLeft.position.set(-3, 8.7, 0)
  roofLeft.rotation.z = 0.62
  farmstead.add(roofLeft)

  const roofRight = new THREE.Mesh(new THREE.BoxGeometry(7, 0.34, 10.4), roofMaterial)
  roofRight.position.set(2.5, 8.7, 0)
  roofRight.rotation.z = -0.62
  farmstead.add(roofRight)

  const roofRidge = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 10.1), trimMaterial)
  roofRidge.position.set(-0.25, 10.4, 0)
  farmstead.add(roofRidge)

  for (const side of [-1, 1]) {
    const eave = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 10.5), trimMaterial)
    eave.position.set(side * 3.65, 8.08, 0)
    farmstead.add(eave)
  }

  const porchFloor = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.22, 3.1), porchMaterial)
  porchFloor.position.set(0, 0.62, 6.15)
  farmstead.add(porchFloor)

  const porchRoof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.22, 3.5), paintMaterial)
  porchRoof.position.set(0, 3.6, 6.15)
  farmstead.add(porchRoof)

  for (let i = -2; i <= 2; i += 1) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.9, 0.2), trimMaterial)
    post.position.set(i * 1.2, 2.05, 7.15)
    farmstead.add(post)
  }

  for (let i = -2; i <= 1; i += 1) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.11, 0.1), trimMaterial)
    rail.position.set(i * 1.2 + 0.6, 1.24, 7.15)
    farmstead.add(rail)
  }

  const door = new THREE.Mesh(new THREE.BoxGeometry(1.35, 2.4, 0.12), trimMaterial)
  door.position.set(0, 1.85, 4.95)
  farmstead.add(door)

  const doorInset = new THREE.Mesh(new THREE.BoxGeometry(0.96, 1.86, 0.08), paintMaterial)
  doorInset.position.set(0, 1.84, 5.02)
  farmstead.add(doorInset)

  const stairs = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.42, 1.4), porchMaterial)
  stairs.position.set(0, 0.3, 7.1)
  farmstead.add(stairs)

  const frontWindows = [-4.1, -2.25, 2.25, 4.1]
  for (const x of frontWindows) {
    addWindowPanel(farmstead, {
      frameMaterial: trimMaterial,
      height: 1.45,
      paneMaterial: windowPaneMaterial,
      width: 1.1,
      x,
      y: 3,
      z: 4.95,
    })
  }

  const secondWindows = [-2.45, 0, 2.45]
  for (const x of secondWindows) {
    addWindowPanel(farmstead, {
      frameMaterial: trimMaterial,
      height: 1.3,
      paneMaterial: windowPaneMaterial,
      width: 1.02,
      x,
      y: 6.7,
      z: 4.2,
    })
  }

  const sideWindows = [2.4, 5.6]
  for (const y of sideWindows) {
    addWindowPanel(farmstead, {
      frameMaterial: trimMaterial,
      height: 1.35,
      paneMaterial: windowPaneMaterial,
      rotationY: Math.PI / 2,
      width: 1.05,
      x: 6.25,
      y,
      z: -1.2,
    })
    addWindowPanel(farmstead, {
      frameMaterial: trimMaterial,
      height: 1.35,
      paneMaterial: windowPaneMaterial,
      rotationY: -Math.PI / 2,
      width: 1.05,
      x: -6.25,
      y,
      z: 1.1,
    })
  }

  const chimney = new THREE.Mesh(new THREE.BoxGeometry(1.05, 3, 1.05), trimMaterial)
  chimney.position.set(3.2, 9.3, -2.6)
  farmstead.add(chimney)

  const barn = new THREE.Group()
  barn.position.set(14, 0, -6)

  const barnWalls = new THREE.Mesh(
    new THREE.BoxGeometry(11.8, 7.3, 10.4),
    new THREE.MeshStandardMaterial({
      color: 0x8b5f45,
      metalness: 0.02,
      roughness: 0.91,
    }),
  )
  barnWalls.position.y = 3.75
  barn.add(barnWalls)

  const barnRoofLeft = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.35, 11.2), roofMaterial)
  barnRoofLeft.position.set(-2.7, 8.3, 0)
  barnRoofLeft.rotation.z = 0.58
  barn.add(barnRoofLeft)

  const barnRoofRight = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.35, 11.2), roofMaterial)
  barnRoofRight.position.set(2.6, 8.3, 0)
  barnRoofRight.rotation.z = -0.58
  barn.add(barnRoofRight)

  const barnDoor = new THREE.Mesh(new THREE.BoxGeometry(3.1, 3.9, 0.2), trimMaterial)
  barnDoor.position.set(0, 2.05, 5.2)
  barn.add(barnDoor)

  const barnTrim = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.24, 0.22), trimMaterial)
  barnTrim.position.set(0, 4.25, 5.18)
  barn.add(barnTrim)

  farmstead.add(barn)

  const silo = new THREE.Group()
  silo.position.set(21, 0, -8.8)

  const siloBody = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 2.1, 10.6, 14),
    new THREE.MeshStandardMaterial({
      color: 0x9b8a76,
      metalness: 0.05,
      roughness: 0.87,
    }),
  )
  siloBody.position.y = 5.4
  silo.add(siloBody)

  const siloCap = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 2.2, 14),
    new THREE.MeshStandardMaterial({
      color: 0x74604c,
      metalness: 0.04,
      roughness: 0.86,
    }),
  )
  siloCap.position.y = 11.8
  silo.add(siloCap)
  farmstead.add(silo)

  const fenceMaterial = new THREE.MeshStandardMaterial({
    color: 0x705d47,
    metalness: 0.01,
    roughness: 0.93,
  })

  for (let i = 0; i < 22; i += 1) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.3, 0.18), fenceMaterial)
    post.position.set(-16 + i * 2, 0.65, 11.5 + Math.sin(i * 0.36) * 0.35)
    farmstead.add(post)

    if (i < 21) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.12, 0.1), fenceMaterial)
      rail.position.set(-15.05 + i * 2, 1.02, 11.5 + Math.sin(i * 0.36 + 0.18) * 0.35)
      farmstead.add(rail)
    }
  }

  const mailboxPost = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.2, 0.14), fenceMaterial)
  mailboxPost.position.set(-8.4, 0.61, 9.4)
  farmstead.add(mailboxPost)

  const mailbox = new THREE.Mesh(
    new THREE.BoxGeometry(0.66, 0.42, 0.45),
    new THREE.MeshStandardMaterial({
      color: 0x43362b,
      metalness: 0.16,
      roughness: 0.62,
    }),
  )
  mailbox.position.set(-8.1, 1.16, 9.4)
  farmstead.add(mailbox)

  farmstead.rotation.y = -0.08 + (rng() - 0.5) * 0.03
  return farmstead
}

function createCornfieldSystem(rng, initialCamera = null) {
  const group = new THREE.Group()

  const plants = []
  const cornDensityMultiplier = 4
  const spacingScale = 1 / Math.sqrt(cornDensityMultiplier)
  const fieldExtent = 520
  const maxCornRadius = 560

  for (let z = fieldExtent; z >= -fieldExtent; ) {
    const zRatio = Math.min(1, Math.abs(z) / fieldExtent)
    const rowStep = (3.5 + zRatio * 3.1) * spacingScale
    const rowOffset = Math.round(Math.abs(z) * 1.2) % 2 === 0 ? 0 : 1

    for (let x = -fieldExtent; x <= fieldExtent; ) {
      const radial = Math.min(1, Math.hypot(x, z) / fieldExtent)
      const colStep = (2.9 + radial * 3.6) * spacingScale
      const jitterX = (rng() - 0.5) * (0.62 + radial * 1.25) + rowOffset
      const jitterZ = (rng() - 0.5) * (0.52 + radial * 1.05)
      const plantX = x + jitterX
      const plantZ = z + jitterZ
      if (Math.hypot(plantX, plantZ) > maxCornRadius) {
        x += colStep
        continue
      }

      const frontGroundSector = plantZ > 86 && Math.abs(plantX) < 330
      if (frontGroundSector) {
        x += colStep
        continue
      }

      const roadCenter = Math.sin(plantZ * 0.055) * 1.55
      const roadReach = Math.max(0, 1 - Math.abs(plantZ + 84) / 290)
      const roadClearance = (7 + Math.max(0, 5.2 - Math.abs(plantZ + 72) * 0.036)) * roadReach
      if (roadReach > 0.001 && Math.abs(plantX - roadCenter) < roadClearance) {
        x += colStep
        continue
      }

      const inYardZone = plantX > -40 && plantX < 44 && plantZ > -95 && plantZ < -40
      if (inYardZone) {
        x += colStep
        continue
      }

      const keepChance = 1 - radial * 0.68
      if (rng() > keepChance) {
        x += colStep
        continue
      }

      plants.push({
        amp: 0.06 + rng() * 0.11,
        height: 0.9 + rng() * 0.75,
        lean: (rng() - 0.5) * 0.08,
        phase: rng() * TAU,
        x: plantX,
        yaw: rng() * TAU,
        z: plantZ,
      })

      x += colStep
    }

    z -= rowStep
  }

  const chunkSize = 104
  const chunkMap = new Map()

  for (const plant of plants) {
    const chunkX = Math.floor(plant.x / chunkSize)
    const chunkZ = Math.floor(plant.z / chunkSize)
    const key = `${chunkX}|${chunkZ}`

    if (!chunkMap.has(key)) {
      chunkMap.set(key, [])
    }

    chunkMap.get(key).push(plant)
  }

  const stalkGeometry = new THREE.CylinderGeometry(0.03, 0.06, 2.2, 7)
  stalkGeometry.translate(0, 1.1, 0)
  const leafUpperGeometry = new THREE.BoxGeometry(1.05, 0.05, 0.14)
  leafUpperGeometry.rotateZ(0.58)
  leafUpperGeometry.translate(0.33, 1.02, 0)
  const leafLowerGeometry = new THREE.BoxGeometry(0.92, 0.045, 0.12)
  leafLowerGeometry.rotateZ(-0.52)
  leafLowerGeometry.translate(-0.3, 1.34, 0)
  const tasselGeometry = new THREE.ConeGeometry(0.08, 0.34, 6)
  tasselGeometry.translate(0, 2.22, 0)

  const stalkMaterial = new THREE.MeshStandardMaterial({
    color: 0x8a9840,
    metalness: 0.01,
    roughness: 0.92,
    vertexColors: true,
  })
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: 0x9cab4b,
    metalness: 0.01,
    roughness: 0.9,
    vertexColors: true,
  })
  const tasselMaterial = new THREE.MeshStandardMaterial({
    color: 0xaf9a57,
    metalness: 0.01,
    roughness: 0.88,
    vertexColors: true,
  })

  const chunks = []
  const stalkColor = new THREE.Color()
  const leafColor = new THREE.Color()
  const tasselColor = new THREE.Color()

  for (const chunkPlantsRaw of chunkMap.values()) {
    let roughCenterX = 0
    let roughCenterZ = 0
    for (const plant of chunkPlantsRaw) {
      roughCenterX += plant.x
      roughCenterZ += plant.z
    }
    roughCenterX /= chunkPlantsRaw.length
    roughCenterZ /= chunkPlantsRaw.length

    const radialDistance = Math.hypot(roughCenterX, roughCenterZ)
    let lodStride = 1
    if (radialDistance > 470) {
      lodStride = 5
    } else if (radialDistance > 390) {
      lodStride = 4
    } else if (radialDistance > 310) {
      lodStride = 3
    } else if (radialDistance > 230) {
      lodStride = 2
    }

    const chunkPlants =
      lodStride === 1 ? chunkPlantsRaw : chunkPlantsRaw.filter((_, index) => index % lodStride === 0)
    const count = chunkPlants.length
    if (count === 0) {
      continue
    }

    const useLeaves = radialDistance < 320
    const useTassels = radialDistance < 240
    const chunkGroup = new THREE.Group()

    const stalks = new THREE.InstancedMesh(stalkGeometry, stalkMaterial, count)
    const leafUpper = useLeaves ? new THREE.InstancedMesh(leafUpperGeometry, leafMaterial, count) : null
    const leafLower = useLeaves ? new THREE.InstancedMesh(leafLowerGeometry, leafMaterial, count) : null
    const tassels = useTassels ? new THREE.InstancedMesh(tasselGeometry, tasselMaterial, count) : null

    stalks.frustumCulled = false
    if (leafUpper) {
      leafUpper.frustumCulled = false
    }
    if (leafLower) {
      leafLower.frustumCulled = false
    }
    if (tassels) {
      tassels.frustumCulled = false
    }

    let centerX = 0
    let centerZ = 0

    for (let i = 0; i < count; i += 1) {
      const plant = chunkPlants[i]
      centerX += plant.x
      centerZ += plant.z

      stalkColor.setHSL(0.17 + rng() * 0.05, 0.44, 0.34 + rng() * 0.11)
      leafColor.copy(stalkColor).offsetHSL(-0.01, 0.06, 0.04)
      tasselColor.copy(stalkColor).offsetHSL(-0.03, -0.1, 0.2)
      stalks.setColorAt(i, stalkColor)
      if (leafUpper) {
        leafUpper.setColorAt(i, leafColor)
      }
      if (leafLower) {
        leafLower.setColorAt(i, leafColor)
      }
      if (tassels) {
        tassels.setColorAt(i, tasselColor)
      }
    }

    if (stalks.instanceColor) {
      stalks.instanceColor.needsUpdate = true
    }
    if (leafUpper && leafUpper.instanceColor) {
      leafUpper.instanceColor.needsUpdate = true
    }
    if (leafLower && leafLower.instanceColor) {
      leafLower.instanceColor.needsUpdate = true
    }
    if (tassels && tassels.instanceColor) {
      tassels.instanceColor.needsUpdate = true
    }

    centerX /= count
    centerZ /= count
    const center = new THREE.Vector3(centerX, 2.2, centerZ)

    let radius = 16
    for (let i = 0; i < count; i += 1) {
      const plant = chunkPlants[i]
      const dx = plant.x - center.x
      const dz = plant.z - center.z
      radius = Math.max(radius, Math.hypot(dx, dz) + 4.5)
    }

    chunkGroup.add(stalks)
    if (leafUpper) {
      chunkGroup.add(leafUpper)
    }
    if (leafLower) {
      chunkGroup.add(leafLower)
    }
    if (tassels) {
      chunkGroup.add(tassels)
    }
    group.add(chunkGroup)

    chunks.push({
      bounds: new THREE.Sphere(center.clone(), radius),
      center,
      group: chunkGroup,
      leafLower,
      leafUpper,
      lodStride,
      plants: chunkPlants,
      stalks,
      tassels,
    })
  }

  const cullingFrustum = new THREE.Frustum()
  const cullingMatrix = new THREE.Matrix4()
  const maxVisibleDistanceSq = 330 * 330
  const fullDetailDistanceSq = 190 * 190
  let frameCounter = 0

  const updateChunk = (chunk, elapsed, primaryWind, secondaryWind, tertiaryWind) => {
    const count = chunk.plants.length
    for (let i = 0; i < count; i += 1) {
      const plant = chunk.plants[i]
      const gust = Math.sin(elapsed * 1.9 + plant.phase + plant.z * 0.04 + plant.x * 0.03) * 0.36
      const bend = (primaryWind + secondaryWind + tertiaryWind + gust) * plant.amp

      INSTANCE_DUMMY.position.set(plant.x, 0, plant.z)
      INSTANCE_DUMMY.rotation.set(bend * 0.4, plant.yaw + bend * 0.28, bend + plant.lean)
      INSTANCE_DUMMY.scale.set(1, plant.height, 1)
      INSTANCE_DUMMY.updateMatrix()

      chunk.stalks.setMatrixAt(i, INSTANCE_DUMMY.matrix)
      if (chunk.leafUpper) {
        chunk.leafUpper.setMatrixAt(i, INSTANCE_DUMMY.matrix)
      }
      if (chunk.leafLower) {
        chunk.leafLower.setMatrixAt(i, INSTANCE_DUMMY.matrix)
      }
      if (chunk.tassels) {
        chunk.tassels.setMatrixAt(i, INSTANCE_DUMMY.matrix)
      }
    }

    chunk.stalks.instanceMatrix.needsUpdate = true
    if (chunk.leafUpper) {
      chunk.leafUpper.instanceMatrix.needsUpdate = true
    }
    if (chunk.leafLower) {
      chunk.leafLower.instanceMatrix.needsUpdate = true
    }
    if (chunk.tassels) {
      chunk.tassels.instanceMatrix.needsUpdate = true
    }
  }

  const update = (elapsed, camera) => {
    const primaryWind = Math.sin(elapsed * 0.42) * 0.78
    const secondaryWind = Math.sin(elapsed * 1.06 + 0.6) * 0.34
    const tertiaryWind = Math.sin(elapsed * 0.19 + 1.7) * 0.22

    const shouldRecomputeCulling = Boolean(camera && frameCounter % 4 === 0)
    frameCounter += 1

    if (shouldRecomputeCulling && camera) {
      cullingMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      cullingFrustum.setFromProjectionMatrix(cullingMatrix)
    }

    for (const chunk of chunks) {
      if (shouldRecomputeCulling && camera) {
        const dx = chunk.center.x - camera.position.x
        const dz = chunk.center.z - camera.position.z
        const distanceSq = dx * dx + dz * dz
        const withinDistance = distanceSq <= maxVisibleDistanceSq
        const keepFullDetail = distanceSq <= fullDetailDistanceSq
        chunk.group.visible = withinDistance && cullingFrustum.intersectsSphere(chunk.bounds)
        if (chunk.leafUpper) {
          chunk.leafUpper.visible = keepFullDetail
        }
        if (chunk.leafLower) {
          chunk.leafLower.visible = keepFullDetail
        }
        if (chunk.tassels) {
          chunk.tassels.visible = keepFullDetail
        }
      }

      if (!chunk.group.visible) {
        continue
      }

      updateChunk(chunk, elapsed, primaryWind, secondaryWind, tertiaryWind)
    }
  }

  update(0, initialCamera)
  return { group, update }
}

function createAmbientDustSystem(rng) {
  const count = 940
  const particles = new Array(count)
  const positions = new Float32Array(count * 3)
  const geometry = new THREE.BufferGeometry()

  for (let i = 0; i < count; i += 1) {
    particles[i] = {
      baseX: -130 + rng() * 260,
      baseY: 0.3 + rng() * 22,
      baseZ: -206 + rng() * 236,
      phase: rng(),
      speed: 0.03 + rng() * 0.11,
      swirl: 0.4 + rng() * 1.1,
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xcfb086,
      depthWrite: false,
      opacity: 0.28,
      size: 0.7,
      sizeAttenuation: true,
      transparent: true,
    }),
  )

  const update = (elapsed) => {
    const attribute = geometry.attributes.position
    const crossWind = Math.sin(elapsed * 0.21) * 11

    for (let i = 0; i < count; i += 1) {
      const particle = particles[i]
      const index = i * 3
      const horizontalLoop = ((elapsed * particle.speed + particle.phase) % 1) * 260 - 130
      positions[index] = particle.baseX + horizontalLoop * 0.14 + crossWind + Math.sin(elapsed * 0.4 + particle.phase * TAU) * 2.4
      positions[index + 1] =
        particle.baseY +
        Math.sin(elapsed * (0.62 + particle.swirl * 0.18) + particle.phase * 11) * (0.3 + particle.swirl * 0.2)
      positions[index + 2] =
        particle.baseZ + Math.cos(elapsed * (0.39 + particle.swirl * 0.1) + particle.phase * 9) * (1 + particle.swirl)
    }

    attribute.needsUpdate = true
  }

  update(0)
  return { points, update }
}

function createTruckSystem(rng) {
  const group = new THREE.Group()
  const truckRig = new THREE.Group()
  const truckBody = new THREE.Group()
  const wheelPivots = []
  const wheelRadius = 0.42

  const paint = new THREE.MeshStandardMaterial({
    color: 0x6b5647,
    metalness: 0.1,
    roughness: 0.7,
  })
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x2a2521,
    metalness: 0.24,
    roughness: 0.58,
  })
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9aadba,
    metalness: 0,
    roughness: 0.25,
    transparent: true,
    opacity: 0.7,
  })
  const tireMaterial = new THREE.MeshStandardMaterial({
    color: 0x1b1918,
    metalness: 0.03,
    roughness: 0.86,
  })
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: 0x8f8d88,
    metalness: 0.55,
    roughness: 0.28,
  })

  truckRig.add(truckBody)

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(4.15, 0.42, 1.84), darkMetal)
  chassis.position.y = 0.68
  truckBody.add(chassis)

  const bed = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.88, 1.82), paint)
  bed.position.set(-1.05, 1.1, 0)
  truckBody.add(bed)

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.16, 1.52), paint)
  cabin.position.set(1.12, 1.28, 0)
  truckBody.add(cabin)

  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.58, 1.42), paint)
  hood.position.set(2.02, 1.08, 0)
  truckBody.add(hood)

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.18, 1.24), paint)
  roof.position.set(1.16, 1.92, 0)
  truckBody.add(roof)

  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.26, 0.74), glass)
  windshield.position.set(1.84, 1.45, 0)
  windshield.rotation.y = Math.PI / 2
  truckBody.add(windshield)

  for (const side of [-1, 1]) {
    const sideWindow = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.52), glass)
    sideWindow.position.set(1.08, 1.52, side * 0.77)
    sideWindow.rotation.y = side * Math.PI * 0.5
    truckBody.add(sideWindow)
  }

  const bumperFront = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.28, 1.86), darkMetal)
  bumperFront.position.set(2.72, 0.68, 0)
  truckBody.add(bumperFront)

  const bumperRear = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 1.86), darkMetal)
  bumperRear.position.set(-2.14, 0.68, 0)
  truckBody.add(bumperRear)

  const grill = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.42, 1.2),
    new THREE.MeshStandardMaterial({
      color: 0x635d56,
      metalness: 0.47,
      roughness: 0.33,
    }),
  )
  grill.position.set(2.66, 1.12, 0)
  truckBody.add(grill)

  for (const side of [-1, 1]) {
    const headlight = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.16, 0.28),
      new THREE.MeshStandardMaterial({
        color: 0xc7b089,
        emissive: 0x8b6f40,
        emissiveIntensity: 0.1,
        roughness: 0.4,
        metalness: 0.1,
      }),
    )
    headlight.position.set(2.71, 1.06, side * 0.58)
    truckBody.add(headlight)
  }

  const bedRail = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.12, 0.14), darkMetal)
  bedRail.position.set(-1.06, 1.58, 0.88)
  truckBody.add(bedRail)
  const bedRailMirror = bedRail.clone()
  bedRailMirror.position.z = -0.88
  truckBody.add(bedRailMirror)

  const tireGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.34, 20)
  tireGeometry.rotateX(Math.PI / 2)
  const rimGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.35, 18)
  rimGeometry.rotateX(Math.PI / 2)

  const wheelPositions = [
    [-1.22, 0.42, -0.93],
    [-1.22, 0.42, 0.93],
    [1.46, 0.42, -0.93],
    [1.46, 0.42, 0.93],
  ]

  for (const [x, y, z] of wheelPositions) {
    const pivot = new THREE.Group()
    pivot.position.set(x, y, z)
    truckBody.add(pivot)

    const tire = new THREE.Mesh(tireGeometry, tireMaterial)
    pivot.add(tire)

    const rim = new THREE.Mesh(rimGeometry, rimMaterial)
    pivot.add(rim)

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.38, 10),
      new THREE.MeshStandardMaterial({
        color: 0x706860,
        metalness: 0.45,
        roughness: 0.42,
      }),
    )
    hub.rotation.x = Math.PI / 2
    pivot.add(hub)

    wheelPivots.push(pivot)
  }

  group.add(truckRig)

  const dustCount = 320
  const dustSeeds = new Array(dustCount)
  const dustPositions = new Float32Array(dustCount * 3)
  const dustGeometry = new THREE.BufferGeometry()

  for (let i = 0; i < dustCount; i += 1) {
    dustSeeds[i] = {
      lateral: (rng() - 0.5) * 3.8,
      rise: 1.2 + rng() * 1.8,
      seed: rng(),
      speed: 0.7 + rng() * 0.95,
    }
  }

  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
  const dust = new THREE.Points(
    dustGeometry,
    new THREE.PointsMaterial({
      color: 0xc5a175,
      depthWrite: false,
      opacity: 0.34,
      size: 0.98,
      sizeAttenuation: true,
      transparent: true,
    }),
  )
  group.add(dust)

  let wheelRotation = 0

  const update = (elapsed, delta) => {
    const travel = Math.sin(elapsed * 0.23)
    const z = -82 + travel * 92
    const dzDt = Math.cos(elapsed * 0.23) * 21.16
    const roadCenter = Math.sin(z * 0.055) * 1.55
    const dxDz = Math.cos(z * 0.055) * 0.08525
    const wobble = Math.sin(elapsed * 0.8) * 0.26
    const wobbleSpeed = Math.cos(elapsed * 0.8) * 0.208
    const x = roadCenter + wobble
    const dxDt = dxDz * dzDt + wobbleSpeed
    const y = 0.44 + Math.sin(elapsed * 10.2) * 0.03 + Math.cos(elapsed * 2.3) * 0.015

    const yaw = Math.atan2(dzDt, dxDt)
    const heading = yaw + Math.PI
    truckRig.position.set(x, y, z)
    truckRig.rotation.y = heading
    truckBody.rotation.x = Math.sin(elapsed * 11.3) * 0.012
    truckBody.rotation.z = Math.sin(elapsed * 7.2) * 0.018

    const speed = Math.hypot(dxDt, dzDt)
    wheelRotation -= (speed / wheelRadius) * delta
    for (const pivot of wheelPivots) {
      pivot.rotation.z = wheelRotation
    }

    TEMP_FORWARD.set(Math.cos(heading), 0, Math.sin(heading))
    TEMP_SIDE.set(-TEMP_FORWARD.z, 0, TEMP_FORWARD.x)
    TEMP_REAR.copy(truckRig.position).addScaledVector(TEMP_FORWARD, -2.75)
    TEMP_REAR.y = truckRig.position.y + 0.08

    const dustAttribute = dustGeometry.attributes.position
    for (let i = 0; i < dustCount; i += 1) {
      const particle = dustSeeds[i]
      const age = (elapsed * (0.75 + particle.speed * 0.48) + particle.seed * 2.6) % 1
      const distance = 1.2 + age * (8.2 + particle.speed * 3.7)
      const spread = particle.lateral * (0.45 + age * 1.8)
      const index = i * 3

      dustPositions[index] = TEMP_REAR.x - TEMP_FORWARD.x * distance + TEMP_SIDE.x * spread
      dustPositions[index + 1] =
        TEMP_REAR.y + age * particle.rise + Math.sin(elapsed * 4.4 + particle.seed * TAU) * 0.14
      dustPositions[index + 2] = TEMP_REAR.z - TEMP_FORWARD.z * distance + TEMP_SIDE.z * spread
    }

    dustAttribute.needsUpdate = true
  }

  update(0, 0)
  return { group, update }
}

export default {
  id: SCENE_ID,
  title: SCENE_TITLE,
  create() {
    let rootRef = null
    let sceneGroup = null
    let previousBackground = null
    let previousFog = null
    let cornfieldSystem = null
    let truckSystem = null
    let ambientDustSystem = null

    return {
      init({ root, camera, scene }) {
        rootRef = root
        previousBackground = scene.background
        previousFog = scene.fog

        scene.background = new THREE.Color(0xd2c2a8)
        scene.fog = new THREE.Fog(0xc5b08d, 34, 272)

        sceneGroup = new THREE.Group()
        sceneGroup.name = `${SCENE_ID}-group`
        root.add(sceneGroup)

        const rng = createSeededRandom(0x01c021)

        sceneGroup.add(createLightingSet())
        sceneGroup.add(createSkyBackdrop(rng))
        sceneGroup.add(createTerrain(rng))
        sceneGroup.add(createUtilityPoles())
        sceneGroup.add(createFarmstead(rng))

        cornfieldSystem = createCornfieldSystem(rng, camera)
        sceneGroup.add(cornfieldSystem.group)

        truckSystem = createTruckSystem(rng)
        sceneGroup.add(truckSystem.group)

        ambientDustSystem = createAmbientDustSystem(rng)
        sceneGroup.add(ambientDustSystem.points)

        camera.position.set(-40, 5.1, -30)
        camera.lookAt(-4, 4.2, -78)
        clampCameraToFarmhouseGround(camera)
      },

      update({ delta, elapsed, camera }) {
        if (!sceneGroup) {
          return
        }

        clampCameraToFarmhouseGround(camera)

        if (cornfieldSystem) {
          cornfieldSystem.update(elapsed, camera)
        }

        if (truckSystem) {
          truckSystem.update(elapsed, delta)
        }

        if (ambientDustSystem) {
          ambientDustSystem.update(elapsed)
        }
      },

      resize() {},

      dispose({ scene }) {
        if (!sceneGroup) {
          return
        }

        scene.background = previousBackground
        scene.fog = previousFog

        if (rootRef && sceneGroup.parent !== rootRef) {
          rootRef.add(sceneGroup)
        }

        disposeObject3D(sceneGroup)

        rootRef = null
        sceneGroup = null
        previousBackground = null
        previousFog = null
        cornfieldSystem = null
        truckSystem = null
        ambientDustSystem = null
      },
    }
  },
}
