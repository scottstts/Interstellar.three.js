import * as THREE from 'three/webgpu'
import { PointerLookControls } from './controls/PointerLookControls'
import { SceneManager } from './SceneManager'
import { sceneManifest } from './scenes/sceneManifest'
import { disposeObject3D } from './utils/dispose'

const MAX_PIXEL_RATIO = 2

export class ThreeApp {
  constructor(container) {
    this.container = container

    this.renderer = null
    this.scene = null
    this.camera = null
    this.clock = new THREE.Clock()

    this.sceneRoot = null
    this.globalSet = null

    this.controls = null
    this.sceneManager = null
    this.isRendering = false

    this.renderFrame = this.renderFrame.bind(this)
    this.handleResize = this.handleResize.bind(this)
  }

  async init() {
    if (!this.container) {
      throw new Error('Missing viewport container element.')
    }

    this.renderer = new THREE.WebGPURenderer({ antialias: true })
    try {
      await this.renderer.init()
    } catch {
      if (this.renderer) {
        this.renderer.dispose()
        this.renderer = null
      }

      throw new Error('WebGPU initialization failed. This browser or device does not support WebGPU.')
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.95

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x02040a)

    const width = Math.max(this.container.clientWidth, 1)
    const height = Math.max(this.container.clientHeight, 1)

    this.camera = new THREE.PerspectiveCamera(65, width / height, 0.1, 5000)
    this.camera.position.set(0, 2.2, 15)

    this.sceneRoot = new THREE.Group()
    this.scene.add(this.sceneRoot)

    this.globalSet = this.createGlobalSet()
    this.scene.add(this.globalSet)

    this.renderer.setSize(width, height, false)
    this.container.replaceChildren(this.renderer.domElement)

    this.controls = new PointerLookControls(this.camera, this.renderer.domElement)
    this.sceneManager = new SceneManager({
      camera: this.camera,
      manifest: sceneManifest,
      renderer: this.renderer,
      root: this.sceneRoot,
      scene: this.scene,
    })

    await this.sceneManager.load(0)

    window.addEventListener('resize', this.handleResize)
  }

  resumeRendering() {
    if (!this.renderer || this.isRendering) {
      return
    }

    // Prevent a large first delta after being paused for a while.
    this.clock.getDelta()
    this.renderer.setAnimationLoop(this.renderFrame)
    this.isRendering = true
  }

  pauseRendering() {
    if (!this.renderer || !this.isRendering) {
      return
    }

    this.renderer.setAnimationLoop(null)
    this.isRendering = false
  }

  createGlobalSet() {
    const set = new THREE.Group()
    set.name = 'app-global-placeholder'

    return set
  }

  renderFrame() {
    const delta = this.clock.getDelta()
    const elapsed = this.clock.elapsedTime

    if (this.controls) {
      this.controls.update(delta)
    }

    if (this.sceneManager) {
      this.sceneManager.update(delta, elapsed)
    }

    this.renderer.render(this.scene, this.camera)
  }

  handleResize() {
    if (!this.renderer || !this.camera || !this.container) {
      return
    }

    const width = Math.max(this.container.clientWidth, 1)
    const height = Math.max(this.container.clientHeight, 1)

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()

    this.renderer.setSize(width, height, false)

    if (this.sceneManager) {
      this.sceneManager.resize(width, height)
    }
  }

  async goToNextScene() {
    if (!this.sceneManager) {
      return false
    }

    return this.sceneManager.next()
  }

  async goToPreviousScene() {
    if (!this.sceneManager) {
      return false
    }

    return this.sceneManager.previous()
  }

  async goToScene(index) {
    if (!this.sceneManager) {
      return false
    }

    return this.sceneManager.goTo(index)
  }

  getCurrentSceneInfo() {
    if (!this.sceneManager) {
      return null
    }

    return this.sceneManager.getCurrentSceneInfo()
  }

  getSceneList() {
    if (!this.sceneManager) {
      return []
    }

    return this.sceneManager.getSceneList()
  }

  hasNextScene() {
    if (!this.sceneManager) {
      return false
    }

    return this.sceneManager.hasNext()
  }

  hasPreviousScene() {
    if (!this.sceneManager) {
      return false
    }

    return this.sceneManager.hasPrevious()
  }

  dispose() {
    window.removeEventListener('resize', this.handleResize)
    this.pauseRendering()

    if (this.controls) {
      this.controls.dispose()
      this.controls = null
    }

    if (this.sceneManager) {
      this.sceneManager.dispose()
      this.sceneManager = null
    }

    if (this.globalSet) {
      disposeObject3D(this.globalSet)
      this.globalSet = null
    }

    if (this.renderer) {
      this.renderer.dispose()
      this.renderer = null
    }

    this.scene = null
    this.camera = null
  }
}
