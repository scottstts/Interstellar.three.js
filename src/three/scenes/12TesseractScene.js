import * as THREE from 'three/webgpu'
import { disposeObject3D } from '../utils/dispose'

const CORRIDOR_WIDTH = 5.5
const CORRIDOR_HEIGHT = 7.0
const CORRIDOR_LENGTH = 60
const BASE_PITCH = 2.1
const MOVEMENT_KEY_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight'])
const MAX_ORBIT_PITCH = Math.PI / 2 - 0.05
const MIN_ORBIT_RADIUS = 0.001
const SHELF_HIGH_DETAIL_RADIUS = 20
const SHELF_CULL_RADIUS = 34
const LIGHT_HIGH_DETAIL_RADIUS = 22
const DETAIL_HIGH = 2
const DETAIL_LOW = 1
const DETAIL_CULLED = 0
const SHELF_HIGH_DETAIL_RADIUS_SQ = SHELF_HIGH_DETAIL_RADIUS * SHELF_HIGH_DETAIL_RADIUS
const SHELF_CULL_RADIUS_SQ = SHELF_CULL_RADIUS * SHELF_CULL_RADIUS
const LIGHT_HIGH_DETAIL_RADIUS_SQ = LIGHT_HIGH_DETAIL_RADIUS * LIGHT_HIGH_DETAIL_RADIUS
const TMP_COOPER_FOCUS = new THREE.Vector3()
const TMP_CAMERA_ORBIT_OFFSET = new THREE.Vector3()
const TMP_DISTANCE_SAMPLE = new THREE.Vector3()
const COOPER_FOCUS_BOX = new THREE.Box3()

function createBookSpineTexture(seed) {
  const canvas = document.createElement('canvas')
  const width = 1024
  const height = 256
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')

  if (!context) {
    return new THREE.Texture()
  }

  context.fillStyle = '#050302'
  context.fillRect(0, 0, width, height)

  let s = seed || 1
  const rand = () => {
    s = (s * 16807 + 11) % 2147483647
    return (s & 0x7fffffff) / 0x7fffffff
  }

  let x = 0
  while (x < width) {
    const gap = 0.5 + rand() * 3
    const lineWidth = 0.5 + rand() * 2.5
    const randomBand = rand()
    let red = 0
    let green = 0
    let blue = 0

    if (randomBand > 0.93) {
      red = 55 + Math.floor(rand() * 55)
      green = 32 + Math.floor(rand() * 22)
      blue = 12 + Math.floor(rand() * 12)
    } else if (randomBand > 0.6) {
      red = 16 + Math.floor(rand() * 22)
      green = 10 + Math.floor(rand() * 14)
      blue = 4 + Math.floor(rand() * 8)
    } else {
      red = 2 + Math.floor(rand() * 7)
      green = 1 + Math.floor(rand() * 5)
      blue = Math.floor(rand() * 3)
    }

    context.fillStyle = `rgb(${red},${green},${blue})`
    context.fillRect(Math.floor(x), 0, Math.ceil(lineWidth), height)
    x += lineWidth + gap
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(3, 1)
  return texture
}

function createShelfEdgeTexture(seed) {
  const canvas = document.createElement('canvas')
  const width = 256
  const height = 512
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')

  if (!context) {
    return new THREE.Texture()
  }

  context.fillStyle = '#040302'
  context.fillRect(0, 0, width, height)

  let s = seed || 77
  const rand = () => {
    s = (s * 16807 + 11) % 2147483647
    return (s & 0x7fffffff) / 0x7fffffff
  }

  let y = 0
  while (y < height) {
    const gap = 0.5 + rand() * 3
    const lineHeight = 0.5 + rand() * 2
    const randomBand = rand()
    let red = 0
    let green = 0
    let blue = 0

    if (randomBand > 0.88) {
      red = 40 + Math.floor(rand() * 35)
      green = 24 + Math.floor(rand() * 16)
      blue = 8 + Math.floor(rand() * 10)
    } else if (randomBand > 0.5) {
      red = 10 + Math.floor(rand() * 16)
      green = 7 + Math.floor(rand() * 10)
      blue = 3 + Math.floor(rand() * 6)
    } else {
      red = 2 + Math.floor(rand() * 5)
      green = 1 + Math.floor(rand() * 3)
      blue = Math.floor(rand() * 2)
    }

    context.fillStyle = `rgb(${red},${green},${blue})`
    context.fillRect(0, Math.floor(y), width, Math.ceil(lineHeight))
    y += lineHeight + gap
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1, 2)
  return texture
}

function beamMat(hex) {
  return new THREE.MeshStandardMaterial({
    color: hex || 0x111111,
    metalness: 0.85,
    roughness: 0.4,
  })
}

function buildCooper() {
  const cooper = new THREE.Group()

  const suitLight = new THREE.MeshStandardMaterial({ color: 0xbcbcbc, roughness: 0.5, metalness: 0.15 })
  const suitMid = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.2 })
  const suitDark = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6, metalness: 0.3 })
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x1a3d5c, roughness: 0.05, metalness: 0.9 })
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xcc8855, roughness: 0.9 })
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7, metalness: 0.3 })
  const backMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.6, metalness: 0.4 })

  function box(width, height, depth, material, px, py, pz, rx, ry, rz) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material)
    mesh.position.set(px || 0, py || 0, pz || 0)
    if (rx) {
      mesh.rotation.x = rx
    }

    if (ry) {
      mesh.rotation.y = ry
    }

    if (rz) {
      mesh.rotation.z = rz
    }

    return mesh
  }

  const head = new THREE.Group()
  head.add(box(0.52, 0.52, 0.52, suitLight))
  head.add(box(0.42, 0.32, 0.06, visorMat, 0, 0.02, 0.28))
  head.add(box(0.38, 0.28, 0.04, skinMat, 0, 0.02, 0.24))
  head.add(box(0.54, 0.06, 0.06, suitMid, 0, 0.22, 0))
  head.add(box(0.54, 0.06, 0.06, suitMid, 0, -0.1, 0))
  head.position.set(0, 1.82, 0)
  cooper.add(head)

  cooper.add(box(0.28, 0.1, 0.28, suitDark, 0, 1.48, 0))

  cooper.add(box(0.52, 0.8, 0.32, suitLight, 0, 1.1, 0))
  cooper.add(box(0.28, 0.22, 0.03, suitDark, 0, 1.22, 0.18))
  for (let index = 0; index < 3; index += 1) {
    cooper.add(box(0.04, 0.04, 0.025, suitMid, -0.08 + index * 0.08, 1.28, 0.195))
  }

  cooper.add(box(0.54, 0.05, 0.34, suitDark, 0, 1.4, 0))
  cooper.add(box(0.54, 0.06, 0.34, suitDark, 0, 0.72, 0))

  cooper.add(box(0.44, 0.65, 0.22, backMat, 0, 1.1, -0.27))
  cooper.add(box(0.18, 0.45, 0.05, suitDark, 0.06, 1.15, -0.4))
  cooper.add(box(0.06, 0.06, 0.06, suitDark, 0.06, 1.35, -0.42))

  const leftArm = new THREE.Group()
  leftArm.add(box(0.22, 0.68, 0.22, suitLight))
  leftArm.add(box(0.20, 0.18, 0.22, bootMat, 0, -0.43, 0))
  leftArm.position.set(-0.42, 1.18, 0.0)
  leftArm.rotation.z = 0.55
  leftArm.rotation.x = -0.9
  cooper.add(leftArm)

  const rightArm = new THREE.Group()
  rightArm.add(box(0.22, 0.68, 0.22, suitLight))
  rightArm.add(box(0.20, 0.18, 0.22, bootMat, 0, -0.43, 0))
  rightArm.position.set(0.42, 1.22, 0.0)
  rightArm.rotation.z = -0.3
  rightArm.rotation.x = -0.7
  cooper.add(rightArm)

  const leftLeg = new THREE.Group()
  leftLeg.add(box(0.22, 0.72, 0.22, suitLight))
  leftLeg.add(box(0.24, 0.18, 0.30, bootMat, 0, -0.45, 0.03))
  leftLeg.position.set(-0.14, 0.34, 0.0)
  leftLeg.rotation.x = 0.18
  cooper.add(leftLeg)

  const rightLeg = new THREE.Group()
  rightLeg.add(box(0.22, 0.72, 0.22, suitLight))
  rightLeg.add(box(0.24, 0.18, 0.30, bootMat, 0, -0.45, 0.03))
  rightLeg.position.set(0.14, 0.34, 0.0)
  rightLeg.rotation.x = -0.12
  cooper.add(rightLeg)

  cooper.scale.setScalar(1.3)
  return cooper
}

export default {
  id: 'tesseract-bookshelf',
  title: 'Tesseract Bookshelf Sequence',
  create() {
    let group = null
    let staticRoot = null
    let cooper = null
    let keyLight = null
    let startElapsed = null
    let previousBackground = null
    let previousFog = null
    let previousToneMappingExposure = null
    let movementKeyBlockHandler = null
    let mouseOrbitHandler = null
    const orbitState = {
      pitch: 0,
      radius: 0,
      yaw: 0,
    }

    return {
      init({ root, camera, renderer, scene }) {
        previousBackground = scene.background
        previousFog = scene.fog
        previousToneMappingExposure = renderer.toneMappingExposure

        scene.background = new THREE.Color(0x000000)
        scene.fog = new THREE.FogExp2(0x000000, 0.018)
        renderer.toneMappingExposure = 0.55

        camera.fov = 58
        camera.near = 0.05
        camera.far = 300
        camera.position.set(0, 5.5, 6)
        camera.lookAt(0.5, 3.5, 0)
        camera.updateProjectionMatrix()

        group = new THREE.Group()
        group.name = 'scene-12-tesseract'
        root.add(group)

        const bookTextures = [
          createBookSpineTexture(1),
          createBookSpineTexture(42),
          createBookSpineTexture(137),
          createBookSpineTexture(999),
        ]

        const edgeTextures = [
          createShelfEdgeTexture(7),
          createShelfEdgeTexture(53),
        ]

        const bookPanelMats = bookTextures.map((texture) => {
          return new THREE.MeshStandardMaterial({
            map: texture,
            emissiveMap: texture,
            emissive: new THREE.Color(0.7, 0.4, 0.18),
            roughness: 0.95,
            metalness: 0.0,
          })
        })

        const bookPanelMatsRotated = bookTextures.map((texture) => {
          const rotatedTexture = texture.clone()
          rotatedTexture.rotation = Math.PI / 2
          rotatedTexture.center.set(0.5, 0.5)
          return new THREE.MeshStandardMaterial({
            map: rotatedTexture,
            emissiveMap: rotatedTexture,
            emissive: new THREE.Color(0.7, 0.4, 0.18),
            roughness: 0.95,
            metalness: 0.0,
          })
        })

        const edgePanelMats = edgeTextures.map((texture) => {
          return new THREE.MeshStandardMaterial({
            map: texture,
            emissiveMap: texture,
            emissive: new THREE.Color(0.55, 0.3, 0.12),
            roughness: 0.9,
            metalness: 0.05,
          })
        })

        const warmGlowMat = new THREE.MeshStandardMaterial({
          color: 0x331200,
          emissive: new THREE.Color(0.25, 0.09, 0.01),
          roughness: 0.9,
        })

        const cyanGlowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.85, 1.2) })
        const orangeGlowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.45, 0.05) })
        const dimWarmMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.25, 0.02) })

        const cameraCullOrigin = camera.position.clone()
        const classifyPlacement = (x, y, z) => {
          TMP_DISTANCE_SAMPLE.set(x, y, z)
          const distanceSq = cameraCullOrigin.distanceToSquared(TMP_DISTANCE_SAMPLE)
          if (distanceSq > SHELF_CULL_RADIUS_SQ) {
            return DETAIL_CULLED
          }

          if (distanceSq > SHELF_HIGH_DETAIL_RADIUS_SQ) {
            return DETAIL_LOW
          }

          return DETAIL_HIGH
        }

        const dividerBeamMat = beamMat(0x090909)
        const frameBeamMat = beamMat(0x070707)

        let shelfIdx = 0
        const buildBookshelfUnit = (width, height, rotated, detail = 'high') => {
          const shelf = new THREE.Group()
          const isLowDetail = detail === 'low'
          const depth = 0.35
          const panelMats = rotated ? bookPanelMatsRotated : bookPanelMats
          const panelMat = panelMats[shelfIdx % panelMats.length]
          const edgeMat = edgePanelMats[shelfIdx % edgePanelMats.length]
          shelfIdx += 1

          const back = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.04), panelMat)
          back.position.z = depth * 0.5
          shelf.add(back)

          if (!isLowDetail) {
            const glow = new THREE.Mesh(
              new THREE.BoxGeometry(width * 0.96, height * 0.96, 0.005),
              warmGlowMat,
            )
            glow.position.z = depth * 0.5 - 0.025
            shelf.add(glow)
          }

          const shelfCount = isLowDetail
            ? Math.max(2, Math.round(height / 1.35))
            : Math.max(3, Math.round(height / 0.45))
          for (let index = 0; index <= shelfCount; index += 1) {
            const shelfY = -height / 2 + (height / shelfCount) * index
            const board = new THREE.Mesh(
              new THREE.BoxGeometry(width, isLowDetail ? 0.024 : 0.028, depth),
              edgeMat,
            )
            board.position.set(0, shelfY, 0)
            shelf.add(board)
          }

          const dividerCount = isLowDetail
            ? Math.max(1, Math.round(width / 2.25))
            : Math.max(2, Math.round(width / 0.75))
          for (let index = 0; index <= dividerCount; index += 1) {
            const dividerX = -width / 2 + (width / dividerCount) * index
            const divider = new THREE.Mesh(
              new THREE.BoxGeometry(isLowDetail ? 0.016 : 0.02, height, depth),
              dividerBeamMat,
            )
            divider.position.set(dividerX, 0, 0)
            shelf.add(divider)
          }

          if (!isLowDetail) {
            const leftSide = new THREE.Mesh(new THREE.BoxGeometry(depth, height, 0.025), edgeMat)
            leftSide.position.set(-width / 2, 0, 0)
            shelf.add(leftSide)

            const rightSide = new THREE.Mesh(new THREE.BoxGeometry(depth, height, 0.025), edgeMat)
            rightSide.position.set(width / 2, 0, 0)
            shelf.add(rightSide)
          }

          const frameThickness = isLowDetail ? 0.045 : 0.055
          const frameBoxes = isLowDetail
            ? [
                [0, height / 2 + frameThickness / 2, 0, width + frameThickness * 1.6, frameThickness, depth + 0.02],
                [0, -height / 2 - frameThickness / 2, 0, width + frameThickness * 1.6, frameThickness, depth + 0.02],
              ]
            : [
                [0, height / 2 + frameThickness / 2, 0, width + frameThickness * 2, frameThickness, depth + 0.04],
                [0, -height / 2 - frameThickness / 2, 0, width + frameThickness * 2, frameThickness, depth + 0.04],
                [-width / 2 - frameThickness / 2, 0, 0, frameThickness, height, depth + 0.04],
                [width / 2 + frameThickness / 2, 0, 0, frameThickness, height, depth + 0.04],
              ]

          for (const [x, y, z, boxWidth, boxHeight, boxDepth] of frameBoxes) {
            const frame = new THREE.Mesh(
              new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth),
              frameBeamMat,
            )
            frame.position.set(x, y, z)
            shelf.add(frame)
          }

          return shelf
        }

        const tesseractRoot = new THREE.Group()
        group.add(tesseractRoot)

        staticRoot = new THREE.Group()
        staticRoot.name = 'scene-12-tesseract-static'
        tesseractRoot.add(staticRoot)

        const placeShelfUnit = ({ width, height, rotated, x, y, z, rotationX, rotationY }) => {
          const detailLevel = classifyPlacement(x, y, z)
          if (detailLevel === DETAIL_CULLED) {
            return
          }

          const shelf = buildBookshelfUnit(width, height, rotated, detailLevel === DETAIL_HIGH ? 'high' : 'low')
          shelf.position.set(x, y, z)
          if (typeof rotationX === 'number') {
            shelf.rotation.x = rotationX
          }

          if (typeof rotationY === 'number') {
            shelf.rotation.y = rotationY
          }

          staticRoot.add(shelf)
        }

        for (let z = -CORRIDOR_LENGTH; z <= CORRIDOR_LENGTH; z += BASE_PITCH) {
          const height = 3.4
          const width = BASE_PITCH * 0.95
          const sideTransforms = [
            [-CORRIDOR_WIDTH, 1.5, Math.PI / 2],
            [CORRIDOR_WIDTH, 1.5, -Math.PI / 2],
          ]
          for (const [x, y, rotationY] of sideTransforms) {
            placeShelfUnit({ width, height, rotated: true, x, y, z, rotationY })
          }

          const capTransforms = [
            [0, CORRIDOR_HEIGHT, Math.PI / 2],
            [0, -CORRIDOR_HEIGHT + 2, -Math.PI / 2],
          ]
          for (const [x, y, rotationX] of capTransforms) {
            placeShelfUnit({ width, height: height * 0.85, rotated: false, x, y, z, rotationX })
          }
        }

        for (let layer = 1; layer <= 4; layer += 1) {
          const offset = layer * 2.8
          const layerPitch = BASE_PITCH * (1 + layer * 0.08)
          for (let z = -CORRIDOR_LENGTH; z <= CORRIDOR_LENGTH; z += layerPitch) {
            const height = 3.8 + layer * 0.3
            const width = layerPitch * 0.93
            const sideTransforms = [
              [-CORRIDOR_WIDTH - offset, 1.5, Math.PI / 2],
              [CORRIDOR_WIDTH + offset, 1.5, -Math.PI / 2],
            ]
            for (const [x, y, rotationY] of sideTransforms) {
              placeShelfUnit({ width, height, rotated: true, x, y, z, rotationY })
            }

            const capTransforms = [
              [0, CORRIDOR_HEIGHT + offset, Math.PI / 2],
              [0, -CORRIDOR_HEIGHT + 2 - offset, -Math.PI / 2],
            ]
            for (const [x, y, rotationX] of capTransforms) {
              placeShelfUnit({ width, height: height * 0.8, rotated: false, x, y, z, rotationX })
            }
          }
        }

        const addInterLayerConnectors = () => {
          const connectorGroup = new THREE.Group()
          const finMat = beamMat(0x060604)

          for (let layer = 0; layer < 4; layer += 1) {
            const innerOffset = layer * 2.8
            const outerOffset = (layer + 1) * 2.8
            const span = outerOffset - innerOffset

            let zIndex = 0
            for (let z = -CORRIDOR_LENGTH; z <= CORRIDOR_LENGTH; z += 1.6, zIndex += 1) {
              let yIndex = 0
              for (let yOffset = -1.5; yOffset <= 1.8; yOffset += 0.7, yIndex += 1) {
                const y = 1.5 + yOffset
                const detailLevel = classifyPlacement(0, y, z)
                if (detailLevel === DETAIL_CULLED) {
                  continue
                }

                if (detailLevel === DETAIL_LOW && (zIndex + yIndex + layer) % 2 === 1) {
                  continue
                }

                const thickness = detailLevel === DETAIL_HIGH ? 0.025 : 0.018

                const leftFin = new THREE.Mesh(new THREE.BoxGeometry(span, thickness, thickness), finMat)
                leftFin.position.set(-CORRIDOR_WIDTH - innerOffset - span / 2, y, z)
                connectorGroup.add(leftFin)

                const rightFin = new THREE.Mesh(new THREE.BoxGeometry(span, thickness, thickness), finMat)
                rightFin.position.set(CORRIDOR_WIDTH + innerOffset + span / 2, y, z)
                connectorGroup.add(rightFin)
              }
            }

            zIndex = 0
            for (let z = -CORRIDOR_LENGTH; z <= CORRIDOR_LENGTH; z += 2.0, zIndex += 1) {
              let xIndex = 0
              for (let xOffset = -2; xOffset <= 2; xOffset += 0.8, xIndex += 1) {
                const detailLevel = classifyPlacement(xOffset, CORRIDOR_HEIGHT + innerOffset, z)
                if (detailLevel === DETAIL_CULLED) {
                  continue
                }

                if (detailLevel === DETAIL_LOW && (zIndex + xIndex + layer) % 2 === 1) {
                  continue
                }

                const thickness = detailLevel === DETAIL_HIGH ? 0.025 : 0.018

                const topFin = new THREE.Mesh(new THREE.BoxGeometry(thickness, span, thickness), finMat)
                topFin.position.set(xOffset, CORRIDOR_HEIGHT + innerOffset + span / 2, z)
                connectorGroup.add(topFin)

                const bottomFin = new THREE.Mesh(new THREE.BoxGeometry(thickness, span, thickness), finMat)
                bottomFin.position.set(xOffset, -CORRIDOR_HEIGHT + 2 - innerOffset - span / 2, z)
                connectorGroup.add(bottomFin)
              }
            }
          }

          return connectorGroup
        }
        staticRoot.add(addInterLayerConnectors())

        const addBeams = () => {
          const beamGroup = new THREE.Group()
          const pillarMat = beamMat(0x060606)
          const crossBeamMat = beamMat(0x080808)
          const depthBeamMat = beamMat(0x070707)
          const frameMat = beamMat(0x0a0a0a)

          let zIndex = 0
          for (let z = -CORRIDOR_LENGTH; z <= CORRIDOR_LENGTH; z += 4.5, zIndex += 1) {
            for (const x of [-CORRIDOR_WIDTH - 0.2, CORRIDOR_WIDTH + 0.2]) {
              const detailLevel = classifyPlacement(x, 1.5, z)
              if (detailLevel === DETAIL_CULLED) {
                continue
              }

              if (detailLevel === DETAIL_LOW && zIndex % 2 === 1) {
                continue
              }

              const pillar = new THREE.Group()
              pillar.add(
                new THREE.Mesh(
                  new THREE.BoxGeometry(0.05, CORRIDOR_HEIGHT * 2 + 4, detailLevel === DETAIL_HIGH ? 0.15 : 0.12),
                  pillarMat,
                ),
              )

              if (detailLevel === DETAIL_HIGH) {
                for (const flangeY of [-CORRIDOR_HEIGHT - 1.5, CORRIDOR_HEIGHT + 1.5]) {
                  const flange = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.22), pillarMat)
                  flange.position.y = flangeY
                  pillar.add(flange)
                }
              }

              pillar.position.set(x, 1.5, z)
              beamGroup.add(pillar)
            }
          }

          zIndex = 0
          for (let z = -CORRIDOR_LENGTH; z <= CORRIDOR_LENGTH; z += 5.5, zIndex += 1) {
            let yIndex = 0
            for (let y = -CORRIDOR_HEIGHT + 2; y <= CORRIDOR_HEIGHT; y += 3.2, yIndex += 1) {
              const detailLevel = classifyPlacement(0, y, z)
              if (detailLevel === DETAIL_CULLED) {
                continue
              }

              if (detailLevel === DETAIL_LOW && (zIndex + yIndex) % 2 === 1) {
                continue
              }

              const thickness = detailLevel === DETAIL_HIGH ? 0.045 : 0.03
              const beam = new THREE.Mesh(
                new THREE.BoxGeometry(CORRIDOR_WIDTH * 2 + 1, thickness, thickness),
                crossBeamMat,
              )
              beam.position.set(0, y, z)
              beamGroup.add(beam)
            }
          }

          const cornerPositions = [
            [-CORRIDOR_WIDTH, CORRIDOR_HEIGHT],
            [CORRIDOR_WIDTH, CORRIDOR_HEIGHT],
            [-CORRIDOR_WIDTH, -CORRIDOR_HEIGHT + 2],
            [CORRIDOR_WIDTH, -CORRIDOR_HEIGHT + 2],
          ]
          for (const [x, y] of cornerPositions) {
            const depthBeam = new THREE.Mesh(
              new THREE.BoxGeometry(0.06, 0.06, CORRIDOR_LENGTH * 2),
              depthBeamMat,
            )
            depthBeam.position.set(x, y, 0)
            beamGroup.add(depthBeam)
          }

          zIndex = 0
          for (let z = -CORRIDOR_LENGTH; z <= CORRIDOR_LENGTH; z += 4.0, zIndex += 1) {
            const detailLevel = classifyPlacement(CORRIDOR_WIDTH + 4.5, 2, z)
            if (detailLevel === DETAIL_CULLED) {
              continue
            }

            if (detailLevel === DETAIL_LOW && zIndex % 2 === 1) {
              continue
            }

            const frame = new THREE.Group()
            const frameWidth = 3.5
            const frameHeight = 5
            const pieces = [
              [0, frameHeight / 2, frameWidth, 0.06],
              [0, -frameHeight / 2, frameWidth, 0.06],
              [-frameWidth / 2, 0, 0.06, frameHeight],
              [frameWidth / 2, 0, 0.06, frameHeight],
            ]
            for (const [x, y, width, height] of pieces) {
              const edge = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.06), frameMat)
              edge.position.set(x, y, 0)
              frame.add(edge)
            }

            if (detailLevel === DETAIL_HIGH) {
              const diagonal = new THREE.Mesh(
                new THREE.BoxGeometry(0.04, Math.sqrt(frameWidth * frameWidth + frameHeight * frameHeight), 0.04),
                frameMat,
              )
              diagonal.rotation.z = Math.atan2(frameHeight, frameWidth)
              frame.add(diagonal)
            }

            frame.position.set(CORRIDOR_WIDTH + 4.5, 2, z)
            frame.rotation.y = -Math.PI / 2
            beamGroup.add(frame)
          }

          return beamGroup
        }
        staticRoot.add(addBeams())

        const addLightStrips = () => {
          const stripGroup = new THREE.Group()
          const warmAccentMaterials = [
            new THREE.MeshBasicMaterial({ color: new THREE.Color(0.62, 0.2, 0.03) }),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(0.88, 0.32, 0.06) }),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.42, 0.09) }),
          ]
          const coolAccentMaterials = [
            new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.25, 0.52) }),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.38, 0.68) }),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.5, 0.82) }),
          ]

          let zIndex = 0
          for (let z = -CORRIDOR_LENGTH; z <= CORRIDOR_LENGTH; z += 0.9, zIndex += 1) {
            const detailLevel = classifyPlacement(0, CORRIDOR_HEIGHT + 0.3, z)
            if (detailLevel === DETAIL_CULLED) {
              continue
            }

            if (detailLevel === DETAIL_LOW && zIndex % 3 !== 0) {
              continue
            }

            const length = 0.78 + Math.random() * 0.18
            const thickness = detailLevel === DETAIL_HIGH ? 0.025 : 0.018
            const segment = new THREE.Mesh(new THREE.BoxGeometry(length, thickness, 0.02), cyanGlowMat)
            segment.position.set(-CORRIDOR_WIDTH * 0.2, CORRIDOR_HEIGHT + 0.3, z)
            stripGroup.add(segment)

            const segmentMirror = segment.clone()
            segmentMirror.position.set(CORRIDOR_WIDTH * 0.15, CORRIDOR_HEIGHT + 0.28, z)
            stripGroup.add(segmentMirror)
          }

          zIndex = 0
          for (let z = -CORRIDOR_LENGTH; z <= CORRIDOR_LENGTH; z += 1.4, zIndex += 1) {
            const detailLevel = classifyPlacement(0, -CORRIDOR_HEIGHT + 2.4, z)
            if (detailLevel === DETAIL_CULLED) {
              continue
            }

            if (detailLevel === DETAIL_LOW && zIndex % 2 === 1) {
              continue
            }

            const stripWidth = detailLevel === DETAIL_HIGH ? 0.02 : 0.016
            const stripLength = detailLevel === DETAIL_HIGH ? 1.3 : 0.95
            const warmStrip = new THREE.Mesh(new THREE.BoxGeometry(stripWidth, stripWidth, stripLength), orangeGlowMat)
            warmStrip.position.set(-CORRIDOR_WIDTH + 0.2, -CORRIDOR_HEIGHT + 2.4, z)
            stripGroup.add(warmStrip)

            const dimStrip = new THREE.Mesh(new THREE.BoxGeometry(stripWidth, stripWidth, stripLength), dimWarmMat)
            dimStrip.position.set(CORRIDOR_WIDTH - 0.2, -CORRIDOR_HEIGHT + 2.4, z)
            stripGroup.add(dimStrip)
          }

          for (let index = 0; index < 72; index += 1) {
            const isWarm = Math.random() > 0.3
            const matPool = isWarm ? warmAccentMaterials : coolAccentMaterials
            const mat = matPool[Math.floor(Math.random() * matPool.length)]

            const wall = Math.floor(Math.random() * 4)
            const zPos = (Math.random() - 0.5) * CORRIDOR_LENGTH * 1.35
            const length = 0.45 + Math.random() * 1.65
            let accent = null

            if (wall < 2) {
              accent = new THREE.Mesh(new THREE.BoxGeometry(0.01, length, 0.01), mat)
              accent.position.set(
                wall === 0 ? -CORRIDOR_WIDTH - Math.random() * 10 : CORRIDOR_WIDTH + Math.random() * 10,
                Math.random() * (CORRIDOR_HEIGHT * 2) - CORRIDOR_HEIGHT + 2,
                zPos,
              )
            } else {
              accent = new THREE.Mesh(new THREE.BoxGeometry(length, 0.01, 0.01), mat)
              accent.position.set(
                (Math.random() - 0.5) * CORRIDOR_WIDTH * 2,
                wall === 2
                  ? CORRIDOR_HEIGHT + Math.random() * 10
                  : -CORRIDOR_HEIGHT + 2 - Math.random() * 10,
                zPos,
              )
            }

            const detailLevel = classifyPlacement(
              accent.position.x,
              accent.position.y,
              accent.position.z,
            )
            if (detailLevel === DETAIL_CULLED) {
              continue
            }

            if (detailLevel === DETAIL_LOW && index % 2 === 1) {
              continue
            }

            stripGroup.add(accent)
          }

          return stripGroup
        }
        staticRoot.add(addLightStrips())

        cooper = buildCooper()
        cooper.position.set(0.4, 2.5, 2.5)
        cooper.rotation.y = -0.35
        cooper.rotation.z = 0.12
        cooper.rotation.x = -0.08
        tesseractRoot.add(cooper)

        COOPER_FOCUS_BOX.setFromObject(cooper)
        COOPER_FOCUS_BOX.getCenter(TMP_COOPER_FOCUS)
        TMP_CAMERA_ORBIT_OFFSET.copy(camera.position).sub(TMP_COOPER_FOCUS)
        orbitState.radius = Math.max(TMP_CAMERA_ORBIT_OFFSET.length(), MIN_ORBIT_RADIUS)
        orbitState.yaw = Math.atan2(TMP_CAMERA_ORBIT_OFFSET.x, TMP_CAMERA_ORBIT_OFFSET.z)
        orbitState.pitch = THREE.MathUtils.clamp(
          Math.atan2(
            TMP_CAMERA_ORBIT_OFFSET.y,
            Math.max(
              Math.hypot(TMP_CAMERA_ORBIT_OFFSET.x, TMP_CAMERA_ORBIT_OFFSET.z),
              MIN_ORBIT_RADIUS,
            ),
          ),
          -MAX_ORBIT_PITCH,
          MAX_ORBIT_PITCH,
        )

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

        mouseOrbitHandler = (event) => {
          if (document.pointerLockElement !== renderer?.domElement) {
            return
          }

          event.preventDefault()
          event.stopPropagation()
          if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation()
          }

          orbitState.yaw -= event.movementX * 0.0022
          orbitState.pitch = THREE.MathUtils.clamp(
            orbitState.pitch + event.movementY * 0.0018,
            -MAX_ORBIT_PITCH,
            MAX_ORBIT_PITCH,
          )
        }
        window.addEventListener('mousemove', mouseOrbitHandler, true)

        staticRoot.add(new THREE.AmbientLight(0x080818, 0.4))

        keyLight = new THREE.PointLight(0xffeedd, 12, 22)
        keyLight.position.set(0.5, 7, 3)
        tesseractRoot.add(keyLight)

        const fillLight = new THREE.PointLight(0x3355aa, 5, 18)
        fillLight.position.set(-5, -1, 2)
        staticRoot.add(fillLight)

        const rimLight = new THREE.PointLight(0xffeebb, 8, 15)
        rimLight.position.set(-1.5, 4, -5)
        staticRoot.add(rimLight)

        const cyanLight = new THREE.PointLight(0x44aaff, 6, 30)
        cyanLight.position.set(-1, CORRIDOR_HEIGHT + 2, -3)
        staticRoot.add(cyanLight)

        const warmLight1 = new THREE.PointLight(0xff7733, 4, 20)
        warmLight1.position.set(-CORRIDOR_WIDTH + 1, 2, 3)
        staticRoot.add(warmLight1)

        const warmLight2 = new THREE.PointLight(0xff6611, 3, 18)
        warmLight2.position.set(CORRIDOR_WIDTH - 1, 1, -2)
        staticRoot.add(warmLight2)

        const spot = new THREE.SpotLight(0xffffff, 15, 25, Math.PI / 7, 0.6, 1.5)
        spot.position.set(0.5, 9, 3)
        spot.target = cooper
        staticRoot.add(spot)

        for (let index = 0; index < 20; index += 1) {
          const warm = Math.random() > 0.4
          const randomLight = new THREE.PointLight(
            warm
              ? new THREE.Color(0.9, 0.4 + Math.random() * 0.3, 0.05)
              : new THREE.Color(0.1, 0.3 + Math.random() * 0.3, 0.8),
            0.8 + Math.random() * 2.5,
            10 + Math.random() * 12,
          )
          randomLight.position.set(
            (Math.random() - 0.5) * 22,
            Math.random() * 14 - 3,
            (Math.random() - 0.5) * 40,
          )
          TMP_DISTANCE_SAMPLE.copy(randomLight.position)
          if (cameraCullOrigin.distanceToSquared(TMP_DISTANCE_SAMPLE) > LIGHT_HIGH_DETAIL_RADIUS_SQ) {
            continue
          }

          staticRoot.add(randomLight)
        }

        // Keep the static hierarchy from recomputing local matrices each frame.
        staticRoot.updateMatrixWorld(true)
        staticRoot.traverse((object) => {
          object.matrixAutoUpdate = false
          object.updateMatrix()
        })

        startElapsed = null
      },

      update({ camera, elapsed }) {
        if (!camera || !cooper || !keyLight) {
          return
        }

        if (startElapsed === null) {
          startElapsed = elapsed
        }

        const t = elapsed - startElapsed
        cooper.position.y = 2.5 + Math.sin(t * 0.38) * 0.28
        cooper.rotation.z = 0.12 + Math.sin(t * 0.27) * 0.04
        cooper.rotation.x = -0.08 + Math.cos(t * 0.22) * 0.025
        keyLight.position.x = 0.5 + Math.sin(t * 0.17) * 0.6

        COOPER_FOCUS_BOX.setFromObject(cooper)
        COOPER_FOCUS_BOX.getCenter(TMP_COOPER_FOCUS)

        const orbitHorizontal = Math.cos(orbitState.pitch) * orbitState.radius
        TMP_CAMERA_ORBIT_OFFSET.set(
          Math.sin(orbitState.yaw) * orbitHorizontal,
          Math.sin(orbitState.pitch) * orbitState.radius,
          Math.cos(orbitState.yaw) * orbitHorizontal,
        )

        camera.position.copy(TMP_COOPER_FOCUS).add(TMP_CAMERA_ORBIT_OFFSET)
        camera.lookAt(TMP_COOPER_FOCUS)
      },

      resize() {},

      dispose({ scene, renderer }) {
        if (movementKeyBlockHandler) {
          window.removeEventListener('keydown', movementKeyBlockHandler, true)
          movementKeyBlockHandler = null
        }

        if (mouseOrbitHandler) {
          window.removeEventListener('mousemove', mouseOrbitHandler, true)
          mouseOrbitHandler = null
        }

        if (group) {
          disposeObject3D(group)
        }

        group = null
        staticRoot = null
        cooper = null
        keyLight = null
        startElapsed = null
        orbitState.radius = 0
        orbitState.yaw = 0
        orbitState.pitch = 0

        if (scene) {
          scene.background = previousBackground
          scene.fog = previousFog
        }

        if (renderer && previousToneMappingExposure !== null) {
          renderer.toneMappingExposure = previousToneMappingExposure
        }

        previousBackground = null
        previousFog = null
        previousToneMappingExposure = null
      },
    }
  },
}
