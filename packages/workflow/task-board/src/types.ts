export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'approved'

export interface TaskFeedback {
  text: string
  createdAt: number
}

export interface TaskAttachment {
  name: string
  type: string
  dataUrl: string // Base64 data url or text content
}

export interface BoardProject {
  id: string
  name: string
  description?: string | undefined
  path?: string | undefined
}

export interface BoardTask {
  id: string
  text: string
  projectId?: string | undefined
  projectName?: string | undefined
  attachments?: TaskAttachment[] | undefined
  status: TaskStatus
  assignedWorkerId?: string | undefined
  sessionId?: string | undefined
  branchName?: string | undefined
  feedbackHistory?: TaskFeedback[] | undefined
  createdAt: number
  updatedAt: number
  completedAt?: number | undefined
  error?: string | undefined
  mergeConflict?: boolean | undefined
  autoMerge?: boolean | undefined
}

export type WorkerStatus = 'idle' | 'busy'

export interface FallbackModel {
  provider: string
  model: string
  reasoningEffort?: string | undefined
}

export interface BoardWorker {
  id: string
  name: string
  provider: string
  model: string
  reasoningEffort?: string | undefined
  fallbackModels?: FallbackModel[] | undefined
  status: WorkerStatus
  currentTaskId?: string | undefined
}

export interface TaskBoardState {
  autoFulfill: boolean
  autoMerge: boolean
  projects: BoardProject[]
  workers: BoardWorker[]
  tasks: BoardTask[]
}
