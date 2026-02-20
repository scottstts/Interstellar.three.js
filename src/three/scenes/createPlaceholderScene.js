import * as THREE from 'three/webgpu'
import { disposeObject3D } from '../utils/dispose'

export function createPlaceholderSceneDefinition(config) {
  return {
    id: config.id,
    title: config.title,
    create() {
      let cube = null
      let group = null
      let rootRef = null

      return {
        init({ root }) {
          rootRef = root
          group = new THREE.Group()
          group.name = `${config.id}-group`
          root.add(group)

          const geometry = new THREE.BoxGeometry(config.size ?? 4.2, config.size ?? 4.2, config.size ?? 4.2)
          const material = new THREE.MeshStandardMaterial({
            color: config.color,
            metalness: 0.35,
            roughness: 0.55,
          })

          cube = new THREE.Mesh(geometry, material)
          cube.position.set(0, config.height ?? 2.2, -9)
          group.add(cube)
        },

        update({ delta }) {
          if (!cube) {
            return
          }

          cube.rotation.x += (config.rotationSpeedX ?? 0.28) * delta
          cube.rotation.y += (config.rotationSpeedY ?? 0.42) * delta
          cube.rotation.z += (config.rotationSpeedZ ?? 0.12) * delta
        },

        resize() {},

        dispose() {
          if (!group) {
            return
          }

          if (rootRef && group.parent !== rootRef) {
            rootRef.add(group)
          }

          disposeObject3D(group)
          cube = null
          group = null
          rootRef = null
        },
      }
    },
  }
}
