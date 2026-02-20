import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { ThreeApp } from './three/ThreeApp'

const FADE_DURATION_MS = 650

function wait(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })
}

function formatBootErrorMessage(error) {
  if (!(error instanceof Error)) {
    return 'Failed to initialize the scene system.'
  }

  if (error.message.toLowerCase().includes('webgpu')) {
    return 'This browser could not initialize WebGPU. Please switch to a WebGPU-capable browser/device.'
  }

  return error.message
}

function App() {
  const viewportRef = useRef(null)
  const appRef = useRef(null)
  const transitionLockRef = useRef(false)

  const [appState, setAppState] = useState('booting')
  const [fadeOpacity, setFadeOpacity] = useState(0)
  const [fadeTransitionEnabled, setFadeTransitionEnabled] = useState(true)
  const [sceneInfo, setSceneInfo] = useState(null)
  const [sceneList, setSceneList] = useState([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let mounted = true

    const boot = async () => {
      try {
        const app = new ThreeApp(viewportRef.current)
        appRef.current = app
        await app.init()

        if (!mounted) {
          app.dispose()
          return
        }

        app.pauseRendering()
        setSceneInfo(app.getCurrentSceneInfo())
        setSceneList(app.getSceneList())
        setAppState('idle')
      } catch (error) {
        if (!mounted) {
          return
        }

        if (appRef.current) {
          appRef.current.pauseRendering()
        }

        setErrorMessage(formatBootErrorMessage(error))
        setAppState('error')
      }
    }

    boot()

    return () => {
      mounted = false
      if (appRef.current) {
        appRef.current.dispose()
        appRef.current = null
      }
    }
  }, [])

  const hasNextScene = useMemo(() => {
    if (!sceneInfo) {
      return false
    }

    return sceneInfo.index < sceneInfo.total - 1
  }, [sceneInfo])

  const hasPreviousScene = useMemo(() => {
    if (!sceneInfo) {
      return false
    }

    return sceneInfo.index > 0
  }, [sceneInfo])

  const uiIsActive = appState === 'playing' || appState === 'transitioning'
  const isWebGpuError = errorMessage.toLowerCase().includes('webgpu')

  const runSceneTransition = useCallback(
    async (navigationAction) => {
      if (appState !== 'playing' || transitionLockRef.current || !appRef.current) {
        return false
      }

      transitionLockRef.current = true
      setAppState('transitioning')
      setFadeOpacity(1)
      let moved = false

      try {
        await wait(FADE_DURATION_MS)
        moved = await navigationAction()
        if (moved) {
          setSceneInfo(appRef.current.getCurrentSceneInfo())
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Navigation failed.')
        setAppState('error')
        if (appRef.current) {
          appRef.current.pauseRendering()
        }
        setFadeOpacity(0)
        transitionLockRef.current = false
        return false
      }

      setFadeOpacity(0)
      await wait(FADE_DURATION_MS)
      setAppState('playing')
      transitionLockRef.current = false
      return moved
    },
    [appState],
  )

  const handleStart = useCallback(async () => {
    if (appState !== 'idle' || transitionLockRef.current) {
      return
    }

    transitionLockRef.current = true
    setFadeTransitionEnabled(false)
    setFadeOpacity(1)
    await wait(34)

    if (appRef.current) {
      appRef.current.resumeRendering()
    }

    setAppState('transitioning')
    setFadeTransitionEnabled(true)
    setFadeOpacity(0)
    await wait(FADE_DURATION_MS)

    setAppState('playing')
    transitionLockRef.current = false
  }, [appState])

  const handleNextScene = useCallback(async () => {
    if (!hasNextScene || !appRef.current) {
      return
    }

    await runSceneTransition(() => appRef.current.goToNextScene())
  }, [hasNextScene, runSceneTransition])

  const handlePreviousScene = useCallback(async () => {
    if (!hasPreviousScene || !appRef.current) {
      return
    }

    await runSceneTransition(() => appRef.current.goToPreviousScene())
  }, [hasPreviousScene, runSceneTransition])

  const handleSceneSelect = useCallback(
    async (index) => {
      if (!sceneInfo || index === sceneInfo.index || !appRef.current) {
        setMenuOpen(false)
        return
      }

      const changed = await runSceneTransition(() => appRef.current.goToScene(index))
      if (changed) {
        setMenuOpen(false)
      }
    },
    [runSceneTransition, sceneInfo],
  )

  return (
    <div className="app-shell">
      <div className="viewport" ref={viewportRef} />

      {appState === 'booting' && (
        <div className="overlay status-overlay">
          <div className="status-panel">
            <h2>Boot Sequence</h2>
            <p>Preparing renderer and loading scene modules.</p>
          </div>
        </div>
      )}

      {appState === 'idle' && (
        <div className="overlay entrance-overlay">
          <div className="entrance-panel">
            <div className="entrance-layout">
              <div className="entrance-copy-block">
                <p className="entrance-kicker">Three.js Recreation Of</p>
                <h1>Interstellar</h1>
                <div className="entrance-meta">
                  <span>13 Scenes</span>
                </div>
                <button className="primary-action" type="button" onClick={handleStart}>
                  Enter
                </button>
              </div>
              <div className="entrance-art-wrap">
                <img className="entrance-art" src="/logo-tp.png" alt="Endurance ring illustration" />
              </div>
            </div>
          </div>
        </div>
      )}

      {appState === 'error' && (
        <div className="overlay status-overlay">
          <div className="status-panel">
            <h2>{isWebGpuError ? 'WebGPU Unsupported' : 'Render System Error'}</h2>
            <p>{errorMessage}</p>
          </div>
        </div>
      )}

      {uiIsActive && sceneInfo && (
        <>
          <button
            className={`scene-menu-toggle ${menuOpen ? 'is-open' : ''}`}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            disabled={appState !== 'playing'}
          >
            Scenes
          </button>

          <aside className={`scene-menu ${menuOpen ? 'is-open' : ''}`}>
            <div className="scene-menu-header">
              <p>Scene Navigator</p>
              <span>{sceneInfo.total} Total</span>
            </div>
            <div className="scene-menu-list">
              {sceneList.map((scene) => (
                <button
                  key={scene.id}
                  className={scene.index === sceneInfo.index ? 'is-active' : ''}
                  type="button"
                  onClick={() => handleSceneSelect(scene.index)}
                  disabled={appState !== 'playing'}
                >
                  <span>{String(scene.index + 1).padStart(2, '0')}</span>
                  <span>{scene.title}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="scene-hud">
            <p className="scene-counter">
              {String(sceneInfo.index + 1).padStart(2, '0')} / {String(sceneInfo.total).padStart(2, '0')}
            </p>
            <h3>{sceneInfo.title}</h3>
          </div>

          <div className="scene-controls">
            {sceneInfo.index > 0 && (
              <button type="button" onClick={handlePreviousScene} disabled={appState !== 'playing'}>
                Previous Scene
              </button>
            )}
            <button type="button" onClick={handleNextScene} disabled={appState !== 'playing' || !hasNextScene}>
              Next Scene
            </button>
          </div>

          <div className="scene-input-hint">
            <p>WSAD for movement</p>
            <p>Shift down, Space up</p>
            <p>Mouse for view panning</p>
          </div>
        </>
      )}

      <div
        className="fade-layer"
        style={{
          opacity: fadeOpacity,
          transition: `opacity ${fadeTransitionEnabled ? FADE_DURATION_MS : 0}ms ease`,
        }}
      />
    </div>
  )
}

export default App
