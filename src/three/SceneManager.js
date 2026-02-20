import { disposeChildren } from './utils/dispose'

export class SceneManager {
  constructor({ manifest, root, scene, camera, renderer }) {
    this.manifest = manifest
    this.root = root
    this.scene = scene
    this.camera = camera
    this.renderer = renderer

    this.activeSceneIndex = -1
    this.activeSceneInstance = null
  }

  getContext() {
    return {
      camera: this.camera,
      renderer: this.renderer,
      root: this.root,
      scene: this.scene,
    }
  }

  async load(index) {
    if (index < 0 || index >= this.manifest.length) {
      throw new Error(`Scene index out of range: ${index}`)
    }

    this.unloadCurrent()

    const sceneDefinition = this.manifest[index]
    const sceneInstance = sceneDefinition.create()

    this.activeSceneInstance = sceneInstance
    this.activeSceneIndex = index

    if (typeof sceneInstance.init === 'function') {
      await sceneInstance.init(this.getContext())
    }
  }

  async goTo(index) {
    if (index === this.activeSceneIndex) {
      return false
    }

    await this.load(index)
    return true
  }

  update(delta, elapsed) {
    if (!this.activeSceneInstance || typeof this.activeSceneInstance.update !== 'function') {
      return
    }

    this.activeSceneInstance.update({
      ...this.getContext(),
      delta,
      elapsed,
    })
  }

  resize(width, height) {
    if (!this.activeSceneInstance || typeof this.activeSceneInstance.resize !== 'function') {
      return
    }

    this.activeSceneInstance.resize({
      ...this.getContext(),
      height,
      width,
    })
  }

  hasNext() {
    return this.activeSceneIndex < this.manifest.length - 1
  }

  hasPrevious() {
    return this.activeSceneIndex > 0
  }

  async next() {
    if (!this.hasNext()) {
      return false
    }

    await this.load(this.activeSceneIndex + 1)
    return true
  }

  async previous() {
    if (!this.hasPrevious()) {
      return false
    }

    await this.load(this.activeSceneIndex - 1)
    return true
  }

  getSceneList() {
    return this.manifest.map((sceneDefinition, index) => ({
      id: sceneDefinition.id,
      index,
      title: sceneDefinition.title,
    }))
  }

  getCurrentSceneInfo() {
    if (this.activeSceneIndex < 0) {
      return null
    }

    const current = this.manifest[this.activeSceneIndex]
    return {
      id: current.id,
      index: this.activeSceneIndex,
      title: current.title,
      total: this.manifest.length,
    }
  }

  unloadCurrent() {
    if (this.activeSceneInstance && typeof this.activeSceneInstance.dispose === 'function') {
      this.activeSceneInstance.dispose(this.getContext())
    }

    this.activeSceneInstance = null
    this.activeSceneIndex = -1

    disposeChildren(this.root)
  }

  dispose() {
    this.unloadCurrent()
  }
}
