import * as THREE from 'three/webgpu'
import { disposeObject3D } from '../utils/dispose'

const ROOM_WIDTH = 15
const ROOM_DEPTH = 12
const ROOM_HEIGHT = 6

const AIR_DUST_COUNT = 1600
const OUTSIDE_DUST_COUNT = 900
const ANOMALY_LINE_COUNT = 8

function clamp01(value) {
  return THREE.MathUtils.clamp(value, 0, 1)
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1
  }

  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function createSeededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function createDustSpriteTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (!context) {
    const fallback = new THREE.Texture()
    fallback.needsUpdate = true
    return fallback
  }

  const gradient = context.createRadialGradient(size * 0.5, size * 0.5, 0, size * 0.5, size * 0.5, size * 0.5)
  gradient.addColorStop(0, 'rgba(255, 252, 242, 1)')
  gradient.addColorStop(0.2, 'rgba(255, 232, 198, 0.9)')
  gradient.addColorStop(0.65, 'rgba(220, 166, 103, 0.25)')
  gradient.addColorStop(1, 'rgba(220, 166, 103, 0)')

  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function createWoodTexture(rng) {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  if (!context) {
    const fallback = new THREE.Texture()
    fallback.needsUpdate = true
    return fallback
  }

  context.fillStyle = '#4d3020'
  context.fillRect(0, 0, size, size)

  for (let row = 0; row < 48; row += 1) {
    const y = row * (size / 48)
    const alpha = 0.08 + rng() * 0.1
    context.fillStyle = `rgba(29, 18, 12, ${alpha})`
    context.fillRect(0, y, size, 2)
  }

  for (let line = 0; line < 30; line += 1) {
    const x = line * (size / 30) + rng() * 6
    context.fillStyle = 'rgba(22, 12, 8, 0.16)'
    context.fillRect(x, 0, 2 + rng() * 2, size)
  }

  for (let speck = 0; speck < 6500; speck += 1) {
    const x = Math.floor(rng() * size)
    const y = Math.floor(rng() * size)
    const alpha = 0.04 + rng() * 0.18
    context.fillStyle = `rgba(190, 127, 77, ${alpha})`
    context.fillRect(x, y, 1, 1)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(3.8, 2.4)
  texture.needsUpdate = true
  return texture
}

function createCurtainTexture(rng) {
  const width = 256
  const height = 384
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')

  if (!context) {
    const fallback = new THREE.Texture()
    fallback.needsUpdate = true
    return fallback
  }

  const gradient = context.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, 'rgba(252, 235, 204, 0.55)')
  gradient.addColorStop(1, 'rgba(212, 180, 142, 0.1)')
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)

  for (let fold = 0; fold < 20; fold += 1) {
    const x = (fold / 19) * width
    const foldWidth = 4 + rng() * 8
    const alpha = 0.06 + rng() * 0.09
    context.fillStyle = `rgba(255, 241, 218, ${alpha})`
    context.fillRect(x, 0, foldWidth, height)
  }

  for (let dust = 0; dust < 1200; dust += 1) {
    const x = Math.floor(rng() * width)
    const y = Math.floor(rng() * height)
    const alpha = 0.03 + rng() * 0.08
    context.fillStyle = `rgba(255, 244, 228, ${alpha})`
    context.fillRect(x, y, 1, 1)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function createRoomShell(woodTexture) {
  const room = new THREE.Group()

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(ROOM_WIDTH, 0.24, ROOM_DEPTH),
    new THREE.MeshStandardMaterial({
      color: 0x5e3a28,
      map: woodTexture,
      roughness: 0.95,
      metalness: 0.02,
    }),
  )
  floor.position.set(0, -0.12, -1)
  room.add(floor)

  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0x5c3a29,
    roughness: 0.94,
    metalness: 0.02,
  })
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: 0x4b2f22,
    roughness: 0.94,
    metalness: 0.02,
  })
  const ceilingMaterial = new THREE.MeshStandardMaterial({
    color: 0x2e1e17,
    roughness: 0.96,
    metalness: 0,
  })

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(ROOM_WIDTH, ROOM_HEIGHT, 0.22), wallMaterial)
  backWall.position.set(0, ROOM_HEIGHT * 0.5, -ROOM_DEPTH * 0.5 - 1)
  room.add(backWall)

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.22, ROOM_HEIGHT, ROOM_DEPTH), sideMaterial)
  leftWall.position.set(-ROOM_WIDTH * 0.5, ROOM_HEIGHT * 0.5, -1)
  room.add(leftWall)

  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.22, ROOM_HEIGHT, ROOM_DEPTH), sideMaterial)
  rightWall.position.set(ROOM_WIDTH * 0.5, ROOM_HEIGHT * 0.5, -1)
  room.add(rightWall)

  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(ROOM_WIDTH, 0.2, ROOM_DEPTH), ceilingMaterial)
  ceiling.position.set(0, ROOM_HEIGHT + 0.1, -1)
  room.add(ceiling)

  const backTrim = new THREE.Mesh(
    new THREE.BoxGeometry(ROOM_WIDTH, 0.14, 0.3),
    new THREE.MeshStandardMaterial({
      color: 0x2c1a13,
      roughness: 0.9,
      metalness: 0.02,
    }),
  )
  backTrim.position.set(0, 0.05, -ROOM_DEPTH * 0.5 - 0.89)
  room.add(backTrim)

  return room
}

function createWindowSet(curtainTexture) {
  const windowSet = new THREE.Group()
  windowSet.position.set(-ROOM_WIDTH * 0.5 + 0.02, 3.15, -4)
  windowSet.rotation.y = Math.PI * 0.5

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x2c1a12,
    roughness: 0.88,
    metalness: 0.02,
  })

  const glowPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(3.3, 4.4),
    new THREE.MeshBasicMaterial({
      color: 0xf6c38b,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
    }),
  )
  glowPanel.position.set(-0.07, 0, 0)
  windowSet.add(glowPanel)

  const topFrame = new THREE.Mesh(new THREE.BoxGeometry(3.65, 0.16, 0.2), frameMaterial)
  topFrame.position.set(0, 2.25, 0.06)
  windowSet.add(topFrame)

  const bottomFrame = new THREE.Mesh(new THREE.BoxGeometry(3.65, 0.16, 0.2), frameMaterial)
  bottomFrame.position.set(0, -2.25, 0.06)
  windowSet.add(bottomFrame)

  const leftFrame = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.64, 0.2), frameMaterial)
  leftFrame.position.set(-1.8, 0, 0.06)
  windowSet.add(leftFrame)

  const rightFrame = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.64, 0.2), frameMaterial)
  rightFrame.position.set(1.8, 0, 0.06)
  windowSet.add(rightFrame)

  const midFrame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4.4, 0.16), frameMaterial)
  midFrame.position.set(0, 0, 0.06)
  windowSet.add(midFrame)

  const curtain = new THREE.Mesh(
    new THREE.PlaneGeometry(5.7, 4.7, 18, 14),
    new THREE.MeshStandardMaterial({
      color: 0xf5e0c1,
      map: curtainTexture,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  curtain.position.set(0.68, -0.18, 0.22)
  windowSet.add(curtain)

  return {
    curtain,
    glowMaterial: glowPanel.material,
    group: windowSet,
  }
}

function createBookShelf(rng) {
  const shelf = new THREE.Group()
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d2519,
    roughness: 0.87,
    metalness: 0.03,
  })
  const shelfMaterial = new THREE.MeshStandardMaterial({
    color: 0x2b1b12,
    roughness: 0.9,
    metalness: 0.02,
  })

  const leftSide = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.6, 0.62), frameMaterial)
  leftSide.position.set(-1.82, 0, 0.05)
  shelf.add(leftSide)

  const rightSide = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.6, 0.62), frameMaterial)
  rightSide.position.set(1.82, 0, 0.05)
  shelf.add(rightSide)

  const topCap = new THREE.Mesh(new THREE.BoxGeometry(3.86, 0.22, 0.62), frameMaterial)
  topCap.position.set(0, 2.2, 0.05)
  shelf.add(topCap)

  const bottomCap = new THREE.Mesh(new THREE.BoxGeometry(3.86, 0.22, 0.62), frameMaterial)
  bottomCap.position.set(0, -2.2, 0.05)
  shelf.add(bottomCap)

  const backPanel = new THREE.Mesh(
    new THREE.BoxGeometry(3.42, 4.16, 0.06),
    new THREE.MeshStandardMaterial({
      color: 0x2e1d14,
      roughness: 0.94,
      metalness: 0.02,
    }),
  )
  backPanel.position.set(0, 0, -0.21)
  shelf.add(backPanel)

  const innerLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 4.16, 0.58), shelfMaterial)
  innerLeft.position.set(-1.65, 0, 0.05)
  shelf.add(innerLeft)

  const innerRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 4.16, 0.58), shelfMaterial)
  innerRight.position.set(1.65, 0, 0.05)
  shelf.add(innerRight)

  for (let level = 0; level < 4; level += 1) {
    const shelfBoard = new THREE.Mesh(
      new THREE.BoxGeometry(3.35, 0.12, 0.58),
      new THREE.MeshStandardMaterial({
        color: 0x4a2d1f,
        roughness: 0.9,
        metalness: 0.02,
      }),
    )
    shelfBoard.position.set(0, -1.7 + level * 1.13, 0.07)
    shelf.add(shelfBoard)

    let cursor = -1.48
    while (cursor < 1.34) {
      const width = 0.1 + rng() * 0.14
      const height = 0.56 + rng() * 0.46
      const depth = 0.14 + rng() * 0.1
      const saturation = 0.32 + rng() * 0.2
      const lightness = 0.34 + rng() * 0.2

      const bookColor = new THREE.Color().setHSL(0.02 + rng() * 0.12, saturation, lightness)
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        new THREE.MeshStandardMaterial({
          color: bookColor,
          roughness: 0.88,
          metalness: 0.02,
        }),
      )
      book.position.set(cursor + width * 0.5, -2.0 + level * 1.13 + height * 0.5, 0.17 + (rng() - 0.5) * 0.06)
      book.rotation.z = (rng() - 0.5) * 0.06
      shelf.add(book)
      cursor += width + 0.035 + rng() * 0.03

      if (rng() > 0.74 && cursor < 1.16) {
        const stackWidth = 0.22 + rng() * 0.24
        const stackDepth = 0.14 + rng() * 0.1
        const stackHeight = 0.1 + rng() * 0.12
        const stackColor = new THREE.Color().setHSL(0.03 + rng() * 0.1, 0.22 + rng() * 0.2, 0.26 + rng() * 0.16)
        const stack = new THREE.Mesh(
          new THREE.BoxGeometry(stackWidth, stackHeight, stackDepth),
          new THREE.MeshStandardMaterial({
            color: stackColor,
            roughness: 0.9,
            metalness: 0.02,
          }),
        )
        stack.position.set(cursor + stackWidth * 0.5, -2.0 + level * 1.13 + stackHeight * 0.5 + 0.03, 0.2)
        stack.rotation.z = (rng() - 0.5) * 0.08
        shelf.add(stack)
        cursor += stackWidth + 0.04
      }
    }

    const leaningBook = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.86, 0.2),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.04 + rng() * 0.08, 0.3 + rng() * 0.2, 0.24 + rng() * 0.2),
        roughness: 0.9,
        metalness: 0.02,
      }),
    )
    leaningBook.position.set(1.34 - rng() * 0.24, -1.58 + level * 1.13, 0.2)
    leaningBook.rotation.z = -0.32 - rng() * 0.15
    shelf.add(leaningBook)

    if (rng() > 0.4) {
      const horizontalBundle = new THREE.Mesh(
        new THREE.BoxGeometry(0.46 + rng() * 0.24, 0.14 + rng() * 0.08, 0.22),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color().setHSL(0.03 + rng() * 0.1, 0.26 + rng() * 0.2, 0.22 + rng() * 0.14),
          roughness: 0.9,
          metalness: 0.02,
        }),
      )
      horizontalBundle.position.set(-1.2 + rng() * 1.8, -1.92 + level * 1.13, 0.21)
      horizontalBundle.rotation.z = (rng() - 0.5) * 0.06
      shelf.add(horizontalBundle)
    }
  }

  shelf.position.set(0.6, 2.26, -6.63)
  return shelf
}

function createBed() {
  const bed = new THREE.Group()

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a1a13,
    roughness: 0.89,
    metalness: 0.03,
  })
  const mattressMaterial = new THREE.MeshStandardMaterial({
    color: 0x8b6d57,
    roughness: 0.97,
    metalness: 0,
  })
  const blanketMaterial = new THREE.MeshStandardMaterial({
    color: 0x4d3a2e,
    roughness: 0.98,
    metalness: 0,
  })

  const frame = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.48, 5.8), frameMaterial)
  frame.position.y = 0.23
  bed.add(frame)

  const mattress = new THREE.Mesh(new THREE.BoxGeometry(2.92, 0.34, 5.58), mattressMaterial)
  mattress.position.y = 0.64
  bed.add(mattress)

  const blanket = new THREE.Mesh(new THREE.BoxGeometry(2.84, 0.25, 3.86), blanketMaterial)
  blanket.position.set(0, 0.9, 0.46)
  bed.add(blanket)

  const pillow = new THREE.Mesh(
    new THREE.BoxGeometry(1.35, 0.2, 0.72),
    new THREE.MeshStandardMaterial({
      color: 0xa18872,
      roughness: 0.95,
      metalness: 0,
    }),
  )
  pillow.position.set(0, 0.93, -2.1)
  bed.add(pillow)

  const postGeometry = new THREE.CylinderGeometry(0.07, 0.07, 2.0, 14)
  const postOffsets = [
    [-1.45, 1.0, -2.8],
    [1.45, 1.0, -2.8],
    [-1.45, 1.0, 2.8],
    [1.45, 1.0, 2.8],
  ]

  for (const [x, y, z] of postOffsets) {
    const post = new THREE.Mesh(postGeometry, frameMaterial)
    post.position.set(x, y, z)
    bed.add(post)

    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 12, 10),
      new THREE.MeshStandardMaterial({
        color: 0x382319,
        roughness: 0.85,
        metalness: 0.04,
      }),
    )
    cap.position.set(x, 2.03, z)
    bed.add(cap)
  }

  bed.position.set(5.15, 0, -1.9)
  bed.rotation.y = -0.02
  return bed
}

function createCooper() {
  const cooper = new THREE.Group()

  const coatMaterial = new THREE.MeshStandardMaterial({ color: 0x3a2d24, roughness: 0.88, metalness: 0.02 })
  const shirtMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4e3c, roughness: 0.86, metalness: 0.01 })
  const pantsMaterial = new THREE.MeshStandardMaterial({ color: 0x4f5b72, roughness: 0.84, metalness: 0.02 })
  const bootMaterial = new THREE.MeshStandardMaterial({ color: 0x372a23, roughness: 0.8, metalness: 0.06 })
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0x8b6d59, roughness: 0.8, metalness: 0 })
  const hairMaterial = new THREE.MeshStandardMaterial({ color: 0x423027, roughness: 0.74, metalness: 0.03 })

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.86, 1.32, 0.5), coatMaterial)
  torso.position.y = 1.14
  cooper.add(torso)

  const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.78, 0.06), shirtMaterial)
  shirt.position.set(0, 1.18, 0.28)
  cooper.add(shirt)

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.42, 0.42), skinMaterial)
  head.position.set(0.02, 2.02, 0.04)
  cooper.add(head)

  const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.44), hairMaterial)
  hairTop.position.set(0.02, 2.24, 0.04)
  cooper.add(hairTop)

  const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.24, 0.1), hairMaterial)
  hairBack.position.set(0.02, 2.03, -0.16)
  cooper.add(hairBack)

  const hairSideLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.34), hairMaterial)
  hairSideLeft.position.set(-0.21, 2.02, 0.04)
  cooper.add(hairSideLeft)

  const hairSideRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.34), hairMaterial)
  hairSideRight.position.set(0.25, 2.02, 0.04)
  cooper.add(hairSideRight)

  const beard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.16), hairMaterial)
  beard.position.set(0.02, 1.86, 0.14)
  cooper.add(beard)

  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.9, 0.22), coatMaterial)
  leftArm.position.set(-0.55, 1.1, 0.03)
  leftArm.rotation.z = 0.14
  cooper.add(leftArm)

  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.9, 0.22), coatMaterial)
  rightArm.position.set(0.59, 1.06, -0.02)
  rightArm.rotation.z = -0.16
  cooper.add(rightArm)

  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.9, 0.26), pantsMaterial)
  leftLeg.position.set(-0.16, 0.11, 0.03)
  cooper.add(leftLeg)

  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.9, 0.26), pantsMaterial)
  rightLeg.position.set(0.16, 0.11, -0.01)
  cooper.add(rightLeg)

  const leftBoot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.3), bootMaterial)
  leftBoot.position.set(-0.16, -0.42, 0.06)
  cooper.add(leftBoot)

  const rightBoot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.3), bootMaterial)
  rightBoot.position.set(0.16, -0.42, 0.04)
  cooper.add(rightBoot)

  cooper.position.set(-3.0, 0, 3.0)
  cooper.rotation.y = Math.PI * 0.38

  return cooper
}

function createMurph() {
  const murph = new THREE.Group()
  const coatMaterial = new THREE.MeshStandardMaterial({ color: 0x342b27, roughness: 0.9, metalness: 0.01 })
  const sweaterMaterial = new THREE.MeshStandardMaterial({ color: 0x756152, roughness: 0.88, metalness: 0.01 })
  const jeansMaterial = new THREE.MeshStandardMaterial({ color: 0x505d74, roughness: 0.86, metalness: 0.01 })
  const bootMaterial = new THREE.MeshStandardMaterial({ color: 0x372c26, roughness: 0.82, metalness: 0.05 })
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xa1846f, roughness: 0.8, metalness: 0 })
  const hairMaterial = new THREE.MeshStandardMaterial({ color: 0x46342c, roughness: 0.74, metalness: 0.02 })

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.24, 0.44), coatMaterial)
  torso.position.y = 1.1
  murph.add(torso)

  const sweater = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.66, 0.06), sweaterMaterial)
  sweater.position.set(0.03, 1.12, 0.25)
  murph.add(sweater)

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.36, 0.38), skinMaterial)
  head.position.set(0.06, 1.94, 0.05)
  murph.add(head)

  const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.4), hairMaterial)
  hairTop.position.set(0.06, 2.14, 0.05)
  murph.add(hairTop)

  const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.28, 0.1), hairMaterial)
  hairBack.position.set(0.06, 1.96, -0.15)
  murph.add(hairBack)

  const hairSideLeft = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.3), hairMaterial)
  hairSideLeft.position.set(-0.13, 1.95, 0.05)
  murph.add(hairSideLeft)

  const hairSideRight = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.3), hairMaterial)
  hairSideRight.position.set(0.25, 1.95, 0.05)
  murph.add(hairSideRight)

  const ponytail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.1), hairMaterial)
  ponytail.position.set(0.06, 1.75, -0.18)
  murph.add(ponytail)

  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.34), coatMaterial)
  hood.position.set(0.05, 1.72, -0.02)
  murph.add(hood)

  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.84, 0.2), coatMaterial)
  leftArm.position.set(-0.48, 1.06, -0.02)
  leftArm.rotation.z = 0.12
  murph.add(leftArm)

  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.84, 0.2), coatMaterial)
  rightArm.position.set(0.56, 1.04, -0.03)
  rightArm.rotation.z = -0.14
  murph.add(rightArm)

  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.84, 0.23), jeansMaterial)
  leftLeg.position.set(-0.12, 0.08, 0.03)
  murph.add(leftLeg)

  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.84, 0.23), jeansMaterial)
  rightLeg.position.set(0.16, 0.08, -0.02)
  murph.add(rightLeg)

  const leftBoot = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.14, 0.28), bootMaterial)
  leftBoot.position.set(-0.12, -0.41, 0.05)
  murph.add(leftBoot)

  const rightBoot = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.14, 0.28), bootMaterial)
  rightBoot.position.set(0.16, -0.41, 0.03)
  murph.add(rightBoot)

  murph.position.set(2.0, 0, 3.0)
  murph.rotation.y = -Math.PI * 0.9

  return murph
}

function createAnomalyLines() {
  const group = new THREE.Group()
  const lines = []
  const minX = -1.42
  const maxX = 1.42

  for (let index = 0; index < ANOMALY_LINE_COUNT; index += 1) {
    const ratio = index / (ANOMALY_LINE_COUNT - 1)
    const x = THREE.MathUtils.lerp(minX, maxX, ratio)
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.02, 5.1),
      new THREE.MeshStandardMaterial({
        color: 0xb77b46,
        roughness: 0.96,
        metalness: 0.01,
        transparent: true,
        opacity: 0.08,
      }),
    )
    line.position.set(x, 0.03, -0.24 + (index % 2 === 0 ? 0.06 : -0.04))
    line.scale.y = 0.2
    group.add(line)

    lines.push({
      baseY: line.position.y,
      mesh: line,
      phase: ratio * Math.PI * 2,
    })
  }

  return { group, lines }
}

function createAirDust(texture, rng) {
  const positions = new Float32Array(AIR_DUST_COUNT * 3)
  const seeds = new Float32Array(AIR_DUST_COUNT * 5)
  const settleTargets = new Float32Array(AIR_DUST_COUNT * 3)

  for (let index = 0; index < AIR_DUST_COUNT; index += 1) {
    const positionIndex = index * 3
    const seedIndex = index * 5

    const baseX = (rng() - 0.5) * (ROOM_WIDTH - 1.4)
    const baseY = 0.35 + rng() * 4.6
    const baseZ = -5.6 + rng() * 8.6

    positions[positionIndex] = baseX
    positions[positionIndex + 1] = baseY
    positions[positionIndex + 2] = baseZ

    seeds[seedIndex] = rng() * Math.PI * 2
    seeds[seedIndex + 1] = 0.5 + rng() * 1.2
    seeds[seedIndex + 2] = 0.22 + rng() * 0.45
    seeds[seedIndex + 3] = baseX
    seeds[seedIndex + 4] = baseZ

    const lineIndex = Math.floor(rng() * ANOMALY_LINE_COUNT)
    const lineRatio = lineIndex / (ANOMALY_LINE_COUNT - 1)
    settleTargets[positionIndex] = THREE.MathUtils.lerp(-1.42, 1.42, lineRatio) + (rng() - 0.5) * 0.05
    settleTargets[positionIndex + 1] = 0.03 + rng() * 0.03
    settleTargets[positionIndex + 2] = -2.5 + rng() * 4.9
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const material = new THREE.PointsMaterial({
    color: 0xcb8c57,
    size: 0.085,
    transparent: true,
    opacity: 0.48,
    map: texture,
    alphaTest: 0.01,
    blending: THREE.NormalBlending,
    depthWrite: false,
    sizeAttenuation: true,
  })

  const points = new THREE.Points(geometry, material)
  return {
    geometry,
    points,
    positions,
    seeds,
    settleTargets,
  }
}

function createOutsideDust(texture, rng) {
  const positions = new Float32Array(OUTSIDE_DUST_COUNT * 3)
  const seeds = new Float32Array(OUTSIDE_DUST_COUNT * 6)

  for (let index = 0; index < OUTSIDE_DUST_COUNT; index += 1) {
    const positionIndex = index * 3
    const seedIndex = index * 6

    const baseX = -8.6 - rng() * 2.9
    const baseY = 0.2 + rng() * 6.2
    const baseZ = -8 + rng() * 7.6

    positions[positionIndex] = baseX
    positions[positionIndex + 1] = baseY
    positions[positionIndex + 2] = baseZ

    seeds[seedIndex] = baseX
    seeds[seedIndex + 1] = baseY
    seeds[seedIndex + 2] = baseZ
    seeds[seedIndex + 3] = rng() * Math.PI * 2
    seeds[seedIndex + 4] = 0.4 + rng() * 1.6
    seeds[seedIndex + 5] = 0.14 + rng() * 0.35
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const material = new THREE.PointsMaterial({
    color: 0xb36534,
    size: 0.16,
    transparent: true,
    opacity: 0.42,
    map: texture,
    alphaTest: 0.02,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  })

  const points = new THREE.Points(geometry, material)
  return {
    geometry,
    points,
    positions,
    seeds,
  }
}

function updateAirDust(system, elapsed, settleAmount, gustStrength) {
  const { geometry, positions, seeds, settleTargets } = system

  for (let index = 0; index < AIR_DUST_COUNT; index += 1) {
    const positionIndex = index * 3
    const seedIndex = index * 5
    const phase = seeds[seedIndex]
    const speed = seeds[seedIndex + 1]
    const amplitude = seeds[seedIndex + 2]
    const baseX = seeds[seedIndex + 3]
    const baseZ = seeds[seedIndex + 4]

    const chaosX = baseX + gustStrength * 0.8 + Math.sin(elapsed * speed + phase) * amplitude
    const chaosY =
      0.55 +
      (Math.sin(elapsed * (speed * 1.25) + phase * 1.33) * 0.5 + 0.5) * 4.1 +
      Math.cos(elapsed * 0.45 + phase * 0.7) * 0.18
    const chaosZ = baseZ + Math.cos(elapsed * (speed * 0.86) + phase * 0.78) * (amplitude * 1.1)

    const settleT = settleAmount * (0.88 + 0.12 * Math.sin(phase))
    positions[positionIndex] = THREE.MathUtils.lerp(chaosX, settleTargets[positionIndex], settleT)
    positions[positionIndex + 1] = THREE.MathUtils.lerp(chaosY, settleTargets[positionIndex + 1], settleT)
    positions[positionIndex + 2] = THREE.MathUtils.lerp(
      chaosZ,
      settleTargets[positionIndex + 2] + Math.sin(elapsed * 0.82 + phase) * 0.02,
      settleT,
    )
  }

  geometry.attributes.position.needsUpdate = true
}

function updateOutsideDust(system, elapsed, gustStrength) {
  const { geometry, positions, seeds } = system
  for (let index = 0; index < OUTSIDE_DUST_COUNT; index += 1) {
    const positionIndex = index * 3
    const seedIndex = index * 6

    const baseX = seeds[seedIndex]
    const baseY = seeds[seedIndex + 1]
    const baseZ = seeds[seedIndex + 2]
    const phase = seeds[seedIndex + 3]
    const speed = seeds[seedIndex + 4]
    const sway = seeds[seedIndex + 5]

    positions[positionIndex] = baseX + Math.sin(elapsed * (speed * 0.9) + phase) * (0.35 + sway)
    positions[positionIndex + 1] = baseY + Math.sin(elapsed * (speed * 1.7) + phase * 1.3) * (0.32 + sway * 0.5)
    positions[positionIndex + 2] =
      baseZ + Math.cos(elapsed * (speed * 1.25) + phase) * (0.95 + sway * 0.6) + gustStrength * 0.7
  }

  geometry.attributes.position.needsUpdate = true
}

export default {
  id: 'dust-storm-murph-anomaly',
  title: "Dust Storm and Murph's Anomaly",
  create() {
    let group = null
    let rootRef = null
    let sceneRef = null
    let previousBackground = null
    let previousFog = null

    let curtain = null
    let curtainBase = null
    let windowGlowMaterial = null

    let anomalyLines = []

    let outsideDust = null
    let airDust = null

    let outsideWindowLight = null
    let ceilingLight = null
    let bounceFillLight = null
    let frontFillLight = null
    let shelfFillLight = null
    let cooperFillLight = null
    let murphFillLight = null
    let anomalyFloorLight = null

    let animationClock = 0

    return {
      init({ root, camera, scene }) {
        rootRef = root
        sceneRef = scene
        previousBackground = scene.background
        previousFog = scene.fog

        scene.background = new THREE.Color(0x2b211b)
        scene.fog = new THREE.FogExp2(0x4a3426, 0.012)

        group = new THREE.Group()
        group.name = 'scene-03-dust-storm-murph'
        root.add(group)

        camera.position.set(0.45, 2.2, 8.0)
        camera.lookAt(-0.15, 1.35, -2.7)

        const rng = createSeededRandom(302031)
        const woodTexture = createWoodTexture(rng)
        const curtainTexture = createCurtainTexture(rng)

        const room = createRoomShell(woodTexture)
        group.add(room)

        const windowSet = createWindowSet(curtainTexture)
        room.add(windowSet.group)
        curtain = windowSet.curtain
        curtainBase = Float32Array.from(curtain.geometry.attributes.position.array)
        windowGlowMaterial = windowSet.glowMaterial

        const bookShelf = createBookShelf(rng)
        room.add(bookShelf)

        const bed = createBed()
        room.add(bed)

        const cooper = createCooper()
        room.add(cooper)

        const murph = createMurph()
        room.add(murph)

        const anomalyLineSet = createAnomalyLines()
        room.add(anomalyLineSet.group)
        anomalyLines = anomalyLineSet.lines

        const ambient = new THREE.AmbientLight(0x8e7562, 1.25)
        group.add(ambient)

        outsideWindowLight = new THREE.PointLight(0xffcd95, 7.4, 32, 1.48)
        outsideWindowLight.position.set(-7.55, 3.4, -3.85)
        group.add(outsideWindowLight)

        const fill = new THREE.HemisphereLight(0xc29a7b, 0x3a271b, 1.55)
        group.add(fill)

        ceilingLight = new THREE.PointLight(0xffd9b2, 4.8, 24, 1.62)
        ceilingLight.position.set(0.8, 5.35, -1.1)
        group.add(ceilingLight)

        bounceFillLight = new THREE.PointLight(0xc49266, 3.6, 22, 1.72)
        bounceFillLight.position.set(0.4, 1.2, 1.8)
        group.add(bounceFillLight)

        frontFillLight = new THREE.PointLight(0xe0b083, 2.9, 24, 1.74)
        frontFillLight.position.set(-0.2, 2.0, 6.3)
        group.add(frontFillLight)

        shelfFillLight = new THREE.PointLight(0xe1af7f, 3.0, 14, 1.82)
        shelfFillLight.position.set(0.7, 2.7, -5.4)
        group.add(shelfFillLight)

        cooperFillLight = new THREE.PointLight(0xffc89a, 2.4, 5.6, 1.95)
        cooperFillLight.position.set(-0.26, 1.88, 0.7)
        cooper.add(cooperFillLight)

        murphFillLight = new THREE.PointLight(0xffc89a, 2.25, 5.4, 1.95)
        murphFillLight.position.set(0.18, 1.8, 0.68)
        murph.add(murphFillLight)

        const ceilingFixture = new THREE.Mesh(
          new THREE.SphereGeometry(0.15, 12, 10),
          new THREE.MeshStandardMaterial({
            color: 0x3a2d23,
            emissive: new THREE.Color(0xffce9e),
            emissiveIntensity: 0.38,
            roughness: 0.82,
            metalness: 0.08,
          }),
        )
        ceilingFixture.position.set(0.8, 5.15, -1.1)
        group.add(ceilingFixture)

        anomalyFloorLight = new THREE.PointLight(0xffa85e, 0.28, 4.5, 2.3)
        anomalyFloorLight.position.set(0.1, 0.24, -1.05)
        group.add(anomalyFloorLight)

        const insideDustTexture = createDustSpriteTexture()
        const outsideDustTexture = createDustSpriteTexture()
        airDust = createAirDust(insideDustTexture, rng)
        outsideDust = createOutsideDust(outsideDustTexture, rng)
        group.add(outsideDust.points)
        group.add(airDust.points)
      },

      update({ delta, elapsed }) {
        if (!group || !curtain) {
          return
        }

        animationClock += delta

        const cycle = (elapsed % 15.5) / 15.5
        const settleRampIn = smoothstep(0.45, 0.62, cycle)
        const settleHold = 1 - smoothstep(0.88, 0.98, cycle)
        const settleAmount = clamp01(settleRampIn * settleHold)

        const gustStrength = Math.sin(animationClock * 0.8) * 0.55 + Math.sin(animationClock * 1.95) * 0.28

        if (outsideWindowLight) {
          outsideWindowLight.intensity = 6.8 + (1 - settleAmount) * 2.2 + Math.sin(animationClock * 1.1) * 0.35
          outsideWindowLight.position.y = 3.35 + Math.sin(animationClock * 0.45) * 0.12
        }

        if (ceilingLight) {
          ceilingLight.intensity = 4.1 + settleAmount * 1.2 + Math.sin(animationClock * 0.65) * 0.16
        }

        if (bounceFillLight) {
          bounceFillLight.intensity = 3.0 + settleAmount * 0.9 + Math.sin(animationClock * 0.8) * 0.12
        }

        if (frontFillLight) {
          frontFillLight.intensity = 2.4 + settleAmount * 0.72 + Math.sin(animationClock * 0.72) * 0.1
        }

        if (shelfFillLight) {
          shelfFillLight.intensity = 2.45 + (1 - settleAmount) * 0.7 + Math.sin(animationClock * 0.6) * 0.12
        }

        if (cooperFillLight) {
          cooperFillLight.intensity = 2.0 + settleAmount * 0.6 + Math.sin(animationClock * 0.9) * 0.08
        }

        if (murphFillLight) {
          murphFillLight.intensity = 1.85 + settleAmount * 0.56 + Math.sin(animationClock * 0.94 + 1.1) * 0.08
        }

        if (anomalyFloorLight) {
          anomalyFloorLight.intensity = 0.2 + settleAmount * 0.34 + Math.sin(animationClock * 6.4) * 0.02
        }

        if (windowGlowMaterial) {
          windowGlowMaterial.opacity = 0.96 + (1 - settleAmount) * 0.08 + Math.sin(animationClock * 0.9) * 0.03
        }

        for (const anomalyLine of anomalyLines) {
          const pulse = Math.sin(animationClock * 2.4 + anomalyLine.phase) * 0.03
          anomalyLine.mesh.material.opacity = 0.08 + settleAmount * 0.84 + pulse * settleAmount
          anomalyLine.mesh.scale.y = 0.2 + settleAmount * 2.8
          anomalyLine.mesh.position.y = anomalyLine.baseY + settleAmount * 0.01
        }

        if (curtain && curtainBase) {
          const attribute = curtain.geometry.attributes.position
          const positions = attribute.array

          for (let index = 0; index < positions.length; index += 3) {
            const x = curtainBase[index]
            const y = curtainBase[index + 1]
            const slack = clamp01((2.35 - y) / 4.7)
            const liftMask = Math.pow(slack, 1.7)
            const gustPulse = clamp01(0.5 + 0.5 * Math.sin(animationClock * 2.6 + x * 1.3 + y * 0.4))

            const lateral = Math.sin(animationClock * 2.3 + y * 2.6 + x * 1.6) * 0.022 * slack
            const liftBase = (0.2 + gustPulse * 1.35 + Math.max(0, gustStrength) * 0.42) * liftMask
            const liftFlutter = Math.sin(animationClock * 6.0 + x * 3.4 + y * 1.2) * 0.12 * slack
            const verticalLift = liftBase + liftFlutter
            const inwardWind =
              (0.14 + gustPulse * 0.5 + Math.sin(animationClock * 1.8 + y * 1.5) * 0.12) * Math.pow(slack, 1.35)

            positions[index] = curtainBase[index] + lateral
            positions[index + 1] = curtainBase[index + 1] + verticalLift
            positions[index + 2] = curtainBase[index + 2] + Math.max(0.04 * slack, inwardWind)
          }

          attribute.needsUpdate = true
        }

        if (airDust) {
          updateAirDust(airDust, animationClock, settleAmount, gustStrength)
          if (airDust.points.material) {
            airDust.points.material.opacity = 0.44 + (1 - settleAmount) * 0.18
          }
        }

        if (outsideDust) {
          updateOutsideDust(outsideDust, animationClock, gustStrength)
          if (outsideDust.points.material) {
            outsideDust.points.material.opacity = 0.33 + (1 - settleAmount) * 0.23
          }
        }
      },

      resize() {},

      dispose() {
        if (sceneRef) {
          sceneRef.background = previousBackground
          sceneRef.fog = previousFog
        }

        if (group) {
          if (rootRef && group.parent !== rootRef) {
            rootRef.add(group)
          }
          disposeObject3D(group)
        }

        group = null
        rootRef = null
        sceneRef = null
        previousBackground = null
        previousFog = null

        curtain = null
        curtainBase = null
        windowGlowMaterial = null
        anomalyLines = []
        outsideDust = null
        airDust = null
        outsideWindowLight = null
        ceilingLight = null
        bounceFillLight = null
        frontFillLight = null
        shelfFillLight = null
        cooperFillLight = null
        murphFillLight = null
        anomalyFloorLight = null
        animationClock = 0
      },
    }
  },
}
