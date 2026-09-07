import { useEffect, useState } from 'react'
import { TaskBoardView } from './TaskBoardView.tsx'
import type { TaskBoardActions } from './TaskBoardView.tsx'

// Global state for opening task board modal
let isBoardOpen = false
const openListeners = new Set<(open: boolean) => void>()

export function setTaskBoardOpen(open: boolean) {
  isBoardOpen = open
  for (const listener of openListeners) {
    listener(open)
  }
}

export function TaskBoardModalWrapper({ actions }: { actions: TaskBoardActions }) {
  const [isOpen, setIsOpen] = useState(isBoardOpen)

  useEffect(() => {
    const l = (val: boolean) => setIsOpen(val)
    openListeners.add(l)
    return () => { openListeners.delete(l) }
  }, [])

  if (!isOpen) return null

  return (
    <TaskBoardView
      isOpen={isOpen}
      onClose={() => setTaskBoardOpen(false)}
      actions={actions}
    />
  )
}
