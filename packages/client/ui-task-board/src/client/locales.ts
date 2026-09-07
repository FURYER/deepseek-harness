export const zh = {
  'trigger.label': 'Task Board',
  'title': 'Multi-Agent Task Board',
  'autoFulfill': 'Auto-Fulfill',
  'workers': 'Workers',
  'addWorker': 'Add Worker',
  'addTask': 'Add Task',
  'todo': 'To Do',
  'inProgress': 'In Progress',
  'review': 'Review',
  'approved': 'Approved',
} satisfies Record<string, string>

export type TaskBoardKey = keyof typeof zh

export const en = {
  'trigger.label': 'Task Board',
  'title': 'Multi-Agent Task Board',
  'autoFulfill': 'Auto-Fulfill',
  'workers': 'Workers',
  'addWorker': 'Add Worker',
  'addTask': 'Add Task',
  'todo': 'To Do',
  'inProgress': 'In Progress',
  'review': 'Review',
  'approved': 'Approved',
} satisfies Record<TaskBoardKey, string>
