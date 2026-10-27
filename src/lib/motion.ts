import { useReducedMotion } from 'motion/react'
import type { Transition } from 'motion/react'

const easeOut: [number, number, number, number] = [0.22, 1, 0.36, 1]

/** Shared motion rhythm; financial values are rendered immediately, never counted up. */
export const motionTransitions = {
  standard: { duration: 0.22, ease: easeOut } satisfies Transition,
  reveal: { duration: 0.28, ease: easeOut } satisfies Transition,
  feedback: { duration: 0.14, ease: easeOut } satisfies Transition,
  chart: { duration: 0.6, ease: easeOut } satisfies Transition,
  toast: { type: 'spring', stiffness: 420, damping: 36 } satisfies Transition,
}

export function useRevealMotion(index = 0) {
  const reduced = useReducedMotion()
  return {
    initial: reduced ? (false as const) : { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: reduced
      ? { duration: 0 }
      : { ...motionTransitions.reveal, delay: Math.min(Math.max(index, 0), 5) * 0.03 },
  }
}
