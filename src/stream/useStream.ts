import { Stream } from '@ikigaians/house'
import { IKGPlayer } from '@ikigaians/ikgplayer'
import { RefObject, useCallback, useEffect, useRef, useState } from 'react'

import { useConfigStore } from '@repo/ui/store/useConfigStore'
import { useLayoutStore } from '@repo/ui/store/useLayoutStore'
import { useNetworkStore } from '@repo/ui/store/useNetworkStore'
import { useSettingStore } from '@repo/ui/store/useSettingStore'

import { sleep } from '../common/common'
import { initPlayerInstance, PlayerEventType, PlayerStatus, QUALITIES } from '../common/stream'
import useVisibility from './useVisibility'

interface StreamManagementHook {
  player: React.RefObject<IKGPlayer | null>
  isLoading: boolean
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
  isInit: boolean
  snapshot: string
  stopVideoWithSnapshot: () => void
  getSnapshot: () => string
  isPlaying: () => boolean
  resizePlayer: () => void
  setRenderMode: (mode: number) => void
  mutePlayers: () => void
  stopAndDestroy: (playerInstance: IKGPlayer | null) => Promise<void>
  resumeAndSetVolume: (playerInstance: IKGPlayer | null) => Promise<void>
  registerPlayerCallbacks: (playerInstance: IKGPlayer) => void
  doDestroyAndPlay: (retryCount?: number, maxRetry?: number) => Promise<void>
  loadAndPlayVideo: (playerInstance: IKGPlayer, source: string, timeoutMs?: number | undefined) => Promise<void>
  getPlayerStatus: () => PlayerStatus | undefined
  setVideoEl: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>
  isDoDestroyAndPlayRunning: RefObject<boolean>
}

interface UseStreamConfig {
  playbackSettings?: {
    snapshotQuality: number
    snapshotFormat: 'webp' | 'png' | 'jpeg'
    volumeMultiplier: number
    stopDelay?: number
    retryDelay?: number
    maxRetries: number
  }
  renderMode?: number // 0: fit, 1: fill
  onPlay?: () => void
  onStop?: () => void
  onError?: (error: unknown) => void
}

export interface QualityEvent {
  type: 'upgrade' | 'downgrade'
  currentQuality: number
  from?: number
  to?: number
  totalQuality: number
  videoStutter: number
  maxAllowedQuality?: number
}

/**
 * useStream is a custom hook that manages video streaming using IKGPlayer.
 * - Upon initialization, the hook sets up a video player instance and manages its lifecycle.
 * - The hook also manages the visibility of the video player, ensuring it stops when not visible.
 * - It provides methods to play, stop, and get the status of the video player.
 * - The hook also handles network conditions and retries playing the video if it fails.
 *
 * @param config - Configuration object for the stream management hook
 * @param config.playbackSettings - Object containing playback settings
 * @param config.onPlay - Callback function to be called when the video starts playing
 * @param config.onStop - Callback function to be called when the video stops
 * @param config.onError - Callback function to be called when an error occurs
 * @returns {StreamManagementHook} - An object containing methods and state related to video streaming
 */
const useStream = (config: UseStreamConfig = {}): StreamManagementHook => {
  // Default configuration values
  const {
    playbackSettings = {
      snapshotQuality: 0.1,
      snapshotFormat: 'webp',
      volumeMultiplier: 3,
      stopDelay: 10000,
      retryDelay: 10000,
      maxRetries: Infinity,
    },
    renderMode = 1,
    onPlay,
    onStop,
    onError,
  } = config

  // Global state hooks
  const streams = useConfigStore((s) => s.streams)
  const isVisible = useVisibility()

  const { settingQuality, studioVolume, masterVolume } = useSettingStore((s) => ({
    settingQuality: s.videoQuality,
    studioVolume: s.studioVolume,
    masterVolume: s.masterVolume,
  }))

  const { isIdleTimeout, isExpired, isMultiSession, isMaintenance } = useNetworkStore((state) => ({
    isIdleTimeout: state.isIdleTimeout,
    isExpired: state.isExpired,
    isMultiSession: state.isMultiSession,
    isMaintenance: state.isMaintenance,
  }))

  const NetworkConditions = isIdleTimeout || isExpired || isMultiSession || isMaintenance

  // Refs and state management
  const player = useRef<IKGPlayer | null>(null)
  const [videoEl, setVideoEl] = useState<HTMLDivElement | null>(null)
  const [snapshot, setSnapshot] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isInit, setIsInit] = useState<boolean>(false)
  const [streamQuality, setStreamQuality] = useState<number>(settingQuality === 'AUTO' ? 1 : settingQuality)

  const isDoDestroyAndPlayRunning = useRef(false)
  const stateRefs = useRef({ isVisible, isIdleTimeout, isMultiSession, isExpired, isMaintenance, snapshot })

  type DoDestroyAndPlayFn = (retryCount?: number, maxRetry?: number) => Promise<void>
  const doDestroyAndPlayRef = useRef<DoDestroyAndPlayFn | null>(null)

  const calculateVolume = useCallback(
    (): number => studioVolume * masterVolume * playbackSettings.volumeMultiplier,
    [studioVolume, masterVolume, playbackSettings.volumeMultiplier]
  )
  const getPlayerStatus = useCallback((): PlayerStatus | undefined => player.current?.getStatus() as unknown as PlayerStatus, [])

  const isPlaying = useCallback((): boolean => {
    const status = getPlayerStatus()
    return [PlayerStatus.PLAYING, PlayerStatus.PLAYED].includes(status as PlayerStatus)
  }, [getPlayerStatus])

  const getSnapshot = useCallback((): string => {
    if (!player.current) return ''
    try {
      return player.current.snapshot(playbackSettings.snapshotFormat, playbackSettings.snapshotQuality)
    } catch (error) {
      console.warn('Error getting snapshot:', error)
      return ''
    }
  }, [playbackSettings.snapshotFormat, playbackSettings.snapshotQuality])

  const freezeWithSnapshot = useCallback(() => {
    if (stateRefs.current.snapshot) return
    const snapshot = getSnapshot()
    setIsLoading(true)
    if (snapshot) setSnapshot(snapshot)
  }, [getSnapshot])

  const stopAndDestroy = useCallback(async (p: IKGPlayer | null) => {
    if (!p) return

    await p?.stop()
    await p?.destroy()
  }, [])

  const stopVideoWithSnapshot = useCallback(async () => {
    freezeWithSnapshot()

    if (!player.current || !isPlaying()) return

    try {
      await sleep(100) // Small delay to ensure snapshot is displayed before stopping
      console.debug('Destroying player in stopVideoWithSnapshot()')
      await stopAndDestroy(player.current)
      onStop?.()
    } catch (error) {
      console.error('Error stopping video:', error)
    } finally {
      player.current = null
    }
  }, [isPlaying, stopAndDestroy, freezeWithSnapshot, onStop])

  /**
   * Get the stream URL for a specific quality level.
   * @returns The URL of the stream for the specified quality level.
   */

  const getStreamUrl = useCallback((): string => {
    const streamKey = QUALITIES[streamQuality] as keyof Stream // Get the stream source based on the selected quality
    return streams?.primary?.[streamKey] ?? ''
  }, [streams, streamQuality])

  const regQualityModeCallback = useCallback(
    (p: IKGPlayer) => {
      p.on(PlayerEventType.QUALITY_CHANGE, (ev: QualityEvent) => {
        const isAuto = settingQuality === 'AUTO'
        if (!isAuto || !isPlaying()) return

        console.debug('QualityEvent', ev)

        const { to } = ev
        const newQuality = to !== undefined ? to : streamQuality
        console.debug('qualitymode callback setting streamQuality to', newQuality)
        setStreamQuality(newQuality)
      })

      p.configQualityMode(streamQuality, QUALITIES.length)
      console.debug('Player registered quality mode callback')
    },
    [streamQuality, settingQuality, isPlaying]
  )

  const registerPlayerCallbacks = useCallback(
    (p: IKGPlayer) => {
      // TODO: Since player.setMaxLatency is working, we can use the table.finish as win animation trigger and remove this logic, leaving it for now just in case
      // regTimeUpCallback(p)

      if (doDestroyAndPlayRef.current) {
        p.on(PlayerEventType.STOPPED, () => {
          freezeWithSnapshot()
          doDestroyAndPlayRef.current?.()
        })
        p.on(PlayerEventType.ENDED, () => {
          freezeWithSnapshot()
          doDestroyAndPlayRef.current?.()
        })
        p.on(PlayerEventType.ERROR, () => {
          freezeWithSnapshot()
          doDestroyAndPlayRef.current?.()
        })
      }

      if (useSettingStore.getState().videoQuality === 'AUTO') {
        regQualityModeCallback(p)
      }
    },
    [regQualityModeCallback, freezeWithSnapshot]
  )

  const loadAndPlayVideo = useCallback(
    async (p: IKGPlayer, source: string, timeoutMs = playbackSettings.retryDelay): Promise<void> => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null

      const { isExpired, isIdleTimeout, isMultiSession, isMaintenance } = stateRefs.current
      if (isExpired || isIdleTimeout || isMultiSession || isMaintenance)
        throw new Error('Network conditions not suitable for playing video')

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId)
      }

      const timeoutPromise = new Promise<void>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('First frame timeout'))
        }, timeoutMs)
      })

      const firstFramePromise = new Promise<void>((resolve, reject) => {
        const onFirstFrame = () => {
          console.debug('First video frame rendered')
          cleanup()
          registerPlayerCallbacks(p)
          resolve()
        }

        const onError = (error: unknown) => {
          console.debug('Error in player:', error)
          cleanup()
          reject(error)
        }

        p.on(PlayerEventType.FIRST_VIDEO_RENDERED, onFirstFrame)
        p.on(PlayerEventType.ERROR, onError)

        p.load(source)
          .then(() => p.play())
          .catch(onError)
      })

      await Promise.race([firstFramePromise, timeoutPromise])
    },
    [registerPlayerCallbacks, playbackSettings.retryDelay]
  )

  const resumeAndSetVolume = useCallback(
    async (p: IKGPlayer | null) => {
      if (!p) return
      await p?.resume()
      p.setVolume(calculateVolume())
    },
    [calculateVolume]
  )

  const play = useCallback(async (): Promise<void> => {
    try {
      const url = getStreamUrl()
      useLayoutStore.setState({ isCanStream: !!url }) // Zustand setter is stable
      console.debug('Playing video with URL:', url)
      if (!url || !videoEl) {
        throw new Error('Player is not initialized')
      }

      // Setup and initialize player
      player.current = initPlayerInstance(videoEl)
      player.current.setRenderMode(renderMode)
      player.current.setVolume(0)
      player.current.setMaxLatency(3) // Set maximum latency to 3 seconds
      player.current.setLogLevel(2) // Set log level to 2

      // Load and play
      await loadAndPlayVideo(player.current, url)
      await resumeAndSetVolume(player.current)
      onPlay?.()
    } catch (error) {
      console.debug('Error in play():', error)
      onError?.(error)
      throw error
    }
  }, [getStreamUrl, loadAndPlayVideo, resumeAndSetVolume, videoEl, renderMode, onPlay, onError])

  const shouldSkipPlay = useCallback(() => {
    const shouldSkip = {
      'No stream URL available': !getStreamUrl(),
      'Player not initialized': !isInit,
      'doDestroyAndPlay already running': isDoDestroyAndPlayRunning.current,
      'Idle timeout active': stateRefs.current.isIdleTimeout,
      'Multi-session detected': stateRefs.current.isMultiSession,
      'Session expired': stateRefs.current.isExpired,
      'Player not visible': !stateRefs.current.isVisible,
    }

    for (const [reason, skip] of Object.entries(shouldSkip)) {
      if (skip) {
        console.debug(`${reason}, skipping play attempt`)
        return true
      }
    }
    return false
  }, [getStreamUrl, isInit])

  /**
   * This is main entry function for playing video.
   * Upon executing, it will first destroy any existing player instance.
   * Then it will create a new player instance and load the video.
   * If the video fails to play, it will automatically retry based on the specified retry settings.
   */
  const doDestroyAndPlay: DoDestroyAndPlayFn = useCallback(
    async (retryCount = 0, maxRetry = playbackSettings.maxRetries): Promise<void> => {
      if (shouldSkipPlay()) return

      isDoDestroyAndPlayRunning.current = true

      // To avoid do the capture when video is loading and have a snapshot already
      if (player.current) {
        try {
          await stopVideoWithSnapshot()
        } catch (cleanupError) {
          console.error('Error during stopAndDestroy:', cleanupError)
        }
        await sleep(50)
      }

      try {
        console.debug(`Attempting to play video (attempt ${retryCount + 1})`)
        setIsLoading(true)
        await play()
        console.debug('Video successfully playing')
        setSnapshot('')
        onPlay?.()
        isDoDestroyAndPlayRunning.current = false
        setIsLoading(false)
      } catch (error) {
        if (retryCount >= maxRetry) {
          useLayoutStore.setState({ isCanStream: false })
          console.debug('Failed to play video after attempts:', error)
          return
        }

        await sleep(playbackSettings.retryDelay)

        isDoDestroyAndPlayRunning.current = false
        if (doDestroyAndPlayRef.current) {
          doDestroyAndPlayRef.current(retryCount + 1, maxRetry)
        }
      }
    },
    [
      shouldSkipPlay,
      play,
      setIsLoading,
      setSnapshot,
      stopVideoWithSnapshot,
      onPlay,
      playbackSettings.retryDelay,
      playbackSettings.maxRetries,
    ]
  )

  const mutePlayers = useCallback(() => {
    if (player.current) player.current.setVolume(0)
  }, [])
  const setRenderMode = useCallback((mode: number) => {
    if (player.current) player.current.setRenderMode(mode)
  }, [])
  const resizePlayer = useCallback(() => {
    if (!videoEl || !player.current) return
    const { width, height } = videoEl.getBoundingClientRect()
    player.current.resize(width, height)
  }, [videoEl])

  // TODO: Since player.setMaxLatency is working, we can use the table.finish as win animation trigger and remove this logic, leaving it for now just in case
  // const regTimeUpCallback = (p: IKGPlayer) => {
  //   const { winResults } = useWinAnimStore.getState()
  //   const undoneTimeCodes = Object.values(winResults).reduce((acc, { timecode }) => {
  //     if (typeof timecode !== 'number') return acc
  //     else return [...acc, timecode]
  //   }, [] as number[])
  //   Object.values(undoneTimeCodes).forEach((timecode) => {
  //     const timecodeNum = Number(timecode)
  //     p.setTimecode(timecodeNum)
  //     console.debug('setTimecode', timecodeNum)
  //   })

  //   p.on('timeup', (timecode: number) => {
  //     console.debug('timeup', timecode)
  //     useWinAnimStore.getState().onTimeUp(timecode)
  //   })
  //   console.debug('Player registered timeup callback', undoneTimeCodes)
  // }

  useEffect(() => {
    stateRefs.current = { isVisible, isIdleTimeout, isMultiSession, isExpired, isMaintenance, snapshot }
  }, [isVisible, isIdleTimeout, isMultiSession, isExpired, isMaintenance, snapshot])

  useEffect(() => {
    doDestroyAndPlayRef.current = doDestroyAndPlay
  }, [doDestroyAndPlay])

  useEffect(() => {
    const shouldPlay = isVisible && !NetworkConditions && isInit
    if (shouldPlay) {
      doDestroyAndPlayRef.current?.()
    } else {
      stopVideoWithSnapshot()
    }
  }, [isVisible, isInit, NetworkConditions, stopVideoWithSnapshot])

  useEffect(() => {
    if (player.current) player.current?.setVolume(calculateVolume())
  }, [calculateVolume])

  // Video quality changed by user
  useEffect(() => {
    if (!videoEl) return

    // Auto stream quality (streamQuality) is controlled by the qualitymode callback
    if (settingQuality === 'AUTO') {
      if (player.current) regQualityModeCallback(player.current)
      console.debug('Video quality set to AUTO')
      return
    }

    // If the user-selected quality is the same as the current stream quality, do nothing
    if (settingQuality === streamQuality) return

    console.debug('Video quality changed by user: ', settingQuality)
    setStreamQuality(settingQuality)
  }, [settingQuality, streamQuality, videoEl, regQualityModeCallback])

  // StreamQuality changed effect
  useEffect(() => {
    doDestroyAndPlayRef.current?.()
  }, [streamQuality])

  // Use ResizeObserver for detecting element size changes
  useEffect(() => {
    if (!videoEl) return
    const observer = new ResizeObserver(resizePlayer)
    observer.observe(videoEl)
    return () => observer.disconnect()
  }, [videoEl, resizePlayer])

  // Side effect hooks (INIT)
  useEffect(() => {
    if (isInit || !videoEl || !streams) return

    setIsInit(true)

    // User touch is needed before setting volume for video
    const setVolume = () => {
      resumeAndSetVolume(player.current)
      document.removeEventListener('touchend', setVolume)
      document.removeEventListener('click', setVolume)
    }
    document.addEventListener('touchend', setVolume)
    document.addEventListener('click', setVolume)

    const clear = async () => {
      if (player.current) {
        try {
          await stopAndDestroy(player.current)
        } catch (error) {
          console.error('Error during player cleanup (INIT useEffect):', error)
        } finally {
          player.current = null
        }
      }
    }

    return () => {
      clear()
    }
  }, [isInit, videoEl, streams, resumeAndSetVolume, stopAndDestroy])

  // Stream rotation effect - restart video when stream URLs change
  useEffect(() => {
    if (!isInit || !streams) return
    doDestroyAndPlayRef.current?.()
  }, [isInit, streams])

  // TODO: Since player.setMaxLatency is working, we can use the table.finish as win animation trigger and remove this logic, leaving it for now just in case
  // Animation win time code effect
  // useEffect(() => {
  //   if (animTimeCode && player.current) {
  //     console.debug('setTimecode', animTimeCode)
  //     player.current.setTimecode(animTimeCode)
  //     useWinAnimStore.setState({ animTimeCode: null })
  //   }
  // }, [animTimeCode])

  return {
    player,
    isLoading,
    setIsLoading,
    isInit,
    snapshot,
    doDestroyAndPlay,
    stopVideoWithSnapshot,
    getSnapshot,
    isPlaying,
    resizePlayer,
    setRenderMode,
    getPlayerStatus,
    setVideoEl,
    mutePlayers,
    stopAndDestroy,
    resumeAndSetVolume,
    loadAndPlayVideo,
    registerPlayerCallbacks,
    isDoDestroyAndPlayRunning,
  }
}

export default useStream
