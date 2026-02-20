function disposeMaterial(material) {
  for (const key of Object.keys(material)) {
    const value = material[key]
    if (value && typeof value === 'object' && value.isTexture) {
      value.dispose()
    }
  }

  if (typeof material.dispose === 'function') {
    material.dispose()
  }
}

export function disposeObject3D(object3D) {
  object3D.traverse((node) => {
    if (node.geometry && typeof node.geometry.dispose === 'function') {
      node.geometry.dispose()
    }

    if (node.material) {
      if (Array.isArray(node.material)) {
        for (const material of node.material) {
          disposeMaterial(material)
        }
      } else {
        disposeMaterial(node.material)
      }
    }
  })

  if (object3D.parent) {
    object3D.parent.remove(object3D)
  }
}

export function disposeChildren(parent) {
  const children = [...parent.children]
  for (const child of children) {
    disposeObject3D(child)
  }
}
