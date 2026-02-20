import * as THREE from 'three/webgpu'

const MAX_PITCH = Math.PI / 2 - 0.01
const UP_VECTOR = new THREE.Vector3(0, 1, 0)
const FORWARD_VECTOR = new THREE.Vector3()
const RIGHT_VECTOR = new THREE.Vector3()
const LOOK_EULER = new THREE.Euler(0, 0, 0, 'YXZ')

export class PointerLookControls {
  constructor(camera, domElement, options = {}) {
    this.camera = camera
    this.domElement = domElement
    this.movementSpeed = options.movementSpeed ?? 9
    this.lookSensitivity = options.lookSensitivity ?? 0.0023
    this.activeKeys = new Set()

    this.yaw = 0
    this.pitch = 0
    this.moveForward = 0
    this.moveStrafe = 0
    this.moveVertical = 0

    this.handleClick = this.handleClick.bind(this)
    this.handleMouseMove = this.handleMouseMove.bind(this)
    this.handleKeyDown = this.handleKeyDown.bind(this)
    this.handleKeyUp = this.handleKeyUp.bind(this)

    this.syncAnglesFromCamera()

    this.domElement.addEventListener('click', this.handleClick)
    window.addEventListener('mousemove', this.handleMouseMove)
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
  }

  syncAnglesFromCamera() {
    LOOK_EULER.setFromQuaternion(this.camera.quaternion, 'YXZ')
    this.pitch = LOOK_EULER.x
    this.yaw = LOOK_EULER.y
  }

  handleClick() {
    if (document.pointerLockElement !== this.domElement) {
      this.domElement.requestPointerLock()
    }
  }

  handleMouseMove(event) {
    if (document.pointerLockElement !== this.domElement) {
      return
    }

    this.yaw -= event.movementX * this.lookSensitivity
    this.pitch -= event.movementY * this.lookSensitivity

    if (this.pitch > MAX_PITCH) {
      this.pitch = MAX_PITCH
    }

    if (this.pitch < -MAX_PITCH) {
      this.pitch = -MAX_PITCH
    }

    LOOK_EULER.set(this.pitch, this.yaw, 0)
    this.camera.quaternion.setFromEuler(LOOK_EULER)
  }

  handleKeyDown(event) {
    this.activeKeys.add(event.code)
  }

  handleKeyUp(event) {
    this.activeKeys.delete(event.code)
  }

  update(deltaSeconds) {
    this.moveForward = 0
    this.moveStrafe = 0
    this.moveVertical = 0

    if (this.activeKeys.has('KeyW')) {
      this.moveForward += 1
    }

    if (this.activeKeys.has('KeyS')) {
      this.moveForward -= 1
    }

    if (this.activeKeys.has('KeyA')) {
      this.moveStrafe -= 1
    }

    if (this.activeKeys.has('KeyD')) {
      this.moveStrafe += 1
    }

    if (this.activeKeys.has('Space')) {
      this.moveVertical += 1
    }

    if (this.activeKeys.has('ShiftLeft') || this.activeKeys.has('ShiftRight')) {
      this.moveVertical -= 1
    }

    if (this.moveForward === 0 && this.moveStrafe === 0 && this.moveVertical === 0) {
      return
    }

    this.camera.getWorldDirection(FORWARD_VECTOR).normalize()
    RIGHT_VECTOR.crossVectors(FORWARD_VECTOR, UP_VECTOR).normalize()

    const movement = this.movementSpeed * deltaSeconds
    if (this.moveForward !== 0) {
      this.camera.position.addScaledVector(FORWARD_VECTOR, this.moveForward * movement)
    }

    if (this.moveStrafe !== 0) {
      this.camera.position.addScaledVector(RIGHT_VECTOR, this.moveStrafe * movement)
    }

    if (this.moveVertical !== 0) {
      this.camera.position.addScaledVector(UP_VECTOR, this.moveVertical * movement)
    }
  }

  dispose() {
    this.domElement.removeEventListener('click', this.handleClick)
    window.removeEventListener('mousemove', this.handleMouseMove)
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
  }
}
