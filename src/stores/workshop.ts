import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'

export type Department = '舞台' | '灯光' | '音响' | '道具'
export type Point = { x: number; y: number }

export type Comment = {
  id: string
  author: string
  content: string
  createdAt: string
  resolved: boolean
}

export type Cue = {
  id: string
  act: string
  scene: string
  time: string
  title: string
  department: Department
  owner: string
  duration: number
  entry: Point
  exit: Point
  route: Point[]
  note: string
  status: '草稿' | '待确认' | '已确认'
  comments: Comment[]
}

export type Venue = { name: string; width: number; depth: number }

export type StagedChange = {
  id: string
  cueId: string
  field: string
  oldValue: unknown
  newValue: unknown
  at: string
  acked: boolean
}

export type FieldVersion = { value: unknown; source: 'local' | 'remote' }

export type FieldConflict = {
  id: string
  cueId: string
  field: string
  local: FieldVersion
  remote: FieldVersion
  resolved: boolean
  chosen: 'local' | 'remote' | null
}

export type BaselineSnapshot = {
  id: string
  batchNo: number
  venue: Venue
  frozenAt: string
  revision: string
  cues: Cue[]
}

export type BatchStatus = 'active' | 'synced' | 'failed'
export type WriteState = 'idle' | 'writing' | 'failed' | 'done'

export type CityBatch = {
  batchNo: number
  fromVenue: Venue | null
  toVenue: Venue
  status: BatchStatus
  startedAt: string
  cues: Cue[]
  batchStartCues: Cue[]
  baseline: BaselineSnapshot | null
  stagedChanges: StagedChange[]
  conflicts: FieldConflict[]
  writeState: WriteState
  writeError: string | null
  confirmationsValid: boolean
  tablesValid: boolean
  lastSyncedAt: string | null
}

export const seedProject = {
  name: '潮汐来信',
  venue: '上海大剧院 · 大剧场',
  rehearsalDate: '2026-10-08',
  company: '远岸剧团',
}

export const seedVenue: Venue = { name: '上海大剧院 · 大剧场', width: 12, depth: 10 }

export const seedMovers = [
  { id: 'M-01', alias: '林默', role: '父亲', group: '主要演员', color: '#d96b45' },
  { id: 'M-02', alias: '周予', role: '女儿', group: '主要演员', color: '#2f8d88' },
  { id: 'M-03', alias: '顾川', role: '灯塔守望者', group: '主要演员', color: '#4f6fb0' },
  { id: 'M-04', alias: '群演甲组', role: '旅客', group: '群演', color: '#ba8c2f' },
  { id: 'M-05', alias: '群演乙组', role: '码头工人', group: '群演', color: '#735ca8' },
]

export const seedCues: Cue[] = [
  {
    id: 'C-01',
    act: '第一幕',
    scene: '启航前夜',
    time: '00:04:20',
    title: '林默从左侧门入场',
    department: '舞台',
    owner: '林默 / 周予',
    duration: 95,
    entry: { x: 10, y: 70 },
    exit: { x: 64, y: 38 },
    route: [{ x: 10, y: 70 }, { x: 35, y: 60 }, { x: 64, y: 38 }],
    note: '灯位切换后 2 秒入场，停在码头箱前。',
    status: '已确认',
    comments: [
      { id: 'c1', author: '王灯控', content: '面光需要延长 4 秒，保证转身动作可见。', createdAt: '2026-09-27 14:20', resolved: false },
    ],
  },
  {
    id: 'C-02',
    act: '第一幕',
    scene: '启航前夜',
    time: '00:06:10',
    title: '信件道具交接',
    department: '道具',
    owner: '周予 / 道具组',
    duration: 40,
    entry: { x: 28, y: 30 },
    exit: { x: 55, y: 47 },
    route: [{ x: 28, y: 30 }, { x: 44, y: 40 }, { x: 55, y: 47 }],
    note: '使用 B 版信封，背台侧完成交接。',
    status: '待确认',
    comments: [],
  },
  {
    id: 'C-03',
    act: '第二幕',
    scene: '风暴',
    time: '00:21:35',
    title: '升降台上升 / 码头位移',
    department: '舞台',
    owner: '舞台机械',
    duration: 120,
    entry: { x: 72, y: 82 },
    exit: { x: 42, y: 50 },
    route: [{ x: 72, y: 82 }, { x: 60, y: 70 }, { x: 42, y: 50 }],
    note: '先确认演员离开危险半径，再启动升降台。',
    status: '草稿',
    comments: [],
  },
  {
    id: 'C-04',
    act: '第二幕',
    scene: '风暴',
    time: '00:23:05',
    title: '爆闪与低频重音',
    department: '灯光',
    owner: '王灯控 / 声场',
    duration: 18,
    entry: { x: 50, y: 12 },
    exit: { x: 50, y: 12 },
    route: [{ x: 50, y: 12 }],
    note: '与机械动作互锁，机械未到位禁止触发。',
    status: '待确认',
    comments: [],
  },
  {
    id: 'C-05',
    act: '第三幕',
    scene: '守望',
    time: '00:37:42',
    title: '三人灯塔调度',
    department: '舞台',
    owner: '主要演员组',
    duration: 70,
    entry: { x: 18, y: 82 },
    exit: { x: 82, y: 18 },
    route: [{ x: 18, y: 82 }, { x: 45, y: 66 }, { x: 68, y: 35 }, { x: 82, y: 18 }],
    note: '群演保持第二条对角线，不遮挡主视线。',
    status: '草稿',
    comments: [],
  },
  {
    id: 'C-06',
    act: '第三幕',
    scene: '守望',
    time: '00:39:10',
    title: '救生艇推入',
    department: '道具',
    owner: '道具组 / 群演乙组',
    duration: 50,
    entry: { x: 88, y: 64 },
    exit: { x: 70, y: 44 },
    route: [{ x: 88, y: 64 }, { x: 80, y: 54 }, { x: 70, y: 44 }],
    note: '与演员横穿路线冲突，需调整优先权。',
    status: '待确认',
    comments: [],
  },
]

const STORAGE_KEY = 'stage-scheduler-draft-v1'

const SCALAR_FIELDS = ['act', 'scene', 'time', 'title', 'department', 'owner', 'duration', 'note', 'status'] as const
const OBJECT_FIELDS = ['entry', 'exit'] as const

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function createInitialBatch(cues: Cue[]): CityBatch {
  return {
    batchNo: 1,
    fromVenue: null,
    toVenue: { ...seedVenue },
    status: 'active',
    startedAt: new Date().toISOString(),
    cues,
    batchStartCues: deepClone(cues),
    baseline: null,
    stagedChanges: [],
    conflicts: [],
    writeState: 'idle',
    writeError: null,
    confirmationsValid: true,
    tablesValid: true,
    lastSyncedAt: null,
  }
}

/**
 * 三向合并：以批次开始快照为基准，比较本地与远端的字段差异。
 * - 两边都改的字段 → 冲突，保留两版来源，等待裁决。
 * - 仅远端改的字段 → 采用远端值。
 * - 仅本地改的字段 → 保留本地值。
 * - 留言按 id 并集合并。
 * 纯函数，不依赖网络，便于离线恢复与测试。
 */
export function mergeBatch(
  batchStartCues: Cue[],
  localCues: Cue[],
  remoteCues: Cue[],
): { cues: Cue[]; conflicts: FieldConflict[] } {
  const merged = deepClone(localCues)
  const conflicts: FieldConflict[] = []
  const startById = new Map(batchStartCues.map((cue) => [cue.id, cue]))
  const remoteById = new Map(remoteCues.map((cue) => [cue.id, cue]))
  const mergedById = new Map(merged.map((cue) => [cue.id, cue]))

  const conflictId = () => `FC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  for (const startCue of batchStartCues) {
    const remoteCue = remoteById.get(startCue.id)
    const localCue = mergedById.get(startCue.id)
    if (!localCue) continue

    for (const field of SCALAR_FIELDS) {
      const startVal = (startCue as Record<string, unknown>)[field]
      const remoteVal = remoteCue ? (remoteCue as Record<string, unknown>)[field] : startVal
      const localVal = (localCue as Record<string, unknown>)[field]
      const localChanged = !deepEqual(localVal, startVal)
      const remoteChanged = !deepEqual(remoteVal, startVal)
      if (localChanged && remoteChanged) {
        conflicts.push({
          id: conflictId(),
          cueId: startCue.id,
          field,
          local: { value: localVal, source: 'local' },
          remote: { value: remoteVal, source: 'remote' },
          resolved: false,
          chosen: null,
        })
      } else if (remoteChanged && !localChanged) {
        ;(localCue as Record<string, unknown>)[field] = deepClone(remoteVal)
      }
    }

    for (const field of OBJECT_FIELDS) {
      const startVal = startCue[field]
      const remoteVal = remoteCue?.[field] ?? startVal
      const localVal = localCue[field]
      const localChanged = !deepEqual(localVal, startVal)
      const remoteChanged = !deepEqual(remoteVal, startVal)
      if (localChanged && remoteChanged) {
        conflicts.push({
          id: conflictId(),
          cueId: startCue.id,
          field,
          local: { value: localVal, source: 'local' },
          remote: { value: remoteVal, source: 'remote' },
          resolved: false,
          chosen: null,
        })
      } else if (remoteChanged && !localChanged) {
        ;(localCue as Record<string, unknown>)[field] = deepClone(remoteVal)
      }
    }

    const startRoute = startCue.route
    const remoteRoute = remoteCue?.route ?? startRoute
    const localRoute = localCue.route
    const localRouteChanged = !deepEqual(localRoute, startRoute)
    const remoteRouteChanged = !deepEqual(remoteRoute, startRoute)
    if (localRouteChanged && remoteRouteChanged) {
      conflicts.push({
        id: conflictId(),
        cueId: startCue.id,
        field: 'route',
        local: { value: localRoute, source: 'local' },
        remote: { value: remoteRoute, source: 'remote' },
        resolved: false,
        chosen: null,
      })
    } else if (remoteRouteChanged && !localRouteChanged) {
      localCue.route = deepClone(remoteRoute)
    }

    const remoteComments = remoteCue?.comments ?? []
    const localCommentIds = new Set(localCue.comments.map((comment) => comment.id))
    for (const remoteComment of remoteComments) {
      if (!localCommentIds.has(remoteComment.id)) {
        localCue.comments.push(deepClone(remoteComment))
      }
    }
  }

  for (const localCue of merged) {
    if (startById.has(localCue.id)) continue
    const remoteCue = remoteById.get(localCue.id)
    if (!remoteCue) continue
    for (const field of SCALAR_FIELDS) {
      const remoteVal = (remoteCue as Record<string, unknown>)[field]
      const localVal = (localCue as Record<string, unknown>)[field]
      if (!deepEqual(localVal, remoteVal)) {
        conflicts.push({
          id: conflictId(),
          cueId: localCue.id,
          field,
          local: { value: localVal, source: 'local' },
          remote: { value: remoteVal, source: 'remote' },
          resolved: false,
          chosen: null,
        })
      }
    }
  }

  for (const remoteCue of remoteCues) {
    if (!startById.has(remoteCue.id) && !mergedById.has(remoteCue.id)) {
      merged.push(deepClone(remoteCue))
    }
  }

  return { cues: merged, conflicts }
}

export const useWorkshopStore = defineStore('workshop', () => {
  const saved = localStorage.getItem(STORAGE_KEY)
  const restored = saved
    ? (JSON.parse(saved) as {
        cues?: Cue[]
        revision?: number
        batch?: CityBatch | null
        baselines?: BaselineSnapshot[]
      })
    : null

  const initialCues = restored?.cues?.length ? restored.cues : deepClone(seedCues)
  const cues = ref<Cue[]>(initialCues)
  const selectedId = ref('C-01')
  const zoom = ref(100)
  const actFilter = ref('全部')
  const departmentFilter = ref('全部')
  const rev = ref(restored?.revision ?? 12)
  const revision = computed(() => `R${rev.value}`)
  const lastSaved = ref('刚刚自动保存')
  const isOffline = ref(false)
  const locked = ref(false)
  const undoStack = ref<Cue[][]>([])
  const redoStack = ref<Cue[][]>([])

  const batch = ref<CityBatch | null>(restored?.batch ?? null)
  const baselines = ref<BaselineSnapshot[]>(restored?.baselines ?? [])
  const viewingBaseline = ref<BaselineSnapshot | null>(null)

  if (!batch.value) {
    batch.value = createInitialBatch(cues.value)
  } else {
    batch.value.cues = cues.value
  }

  const selectedCue = computed(() => cues.value.find((cue) => cue.id === selectedId.value) ?? cues.value[0])
  const filteredCues = computed(() =>
    cues.value.filter(
      (cue) =>
        (actFilter.value === '全部' || cue.act === actFilter.value) &&
        (departmentFilter.value === '全部' || cue.department === departmentFilter.value),
    ),
  )
  const conflicts = computed(() =>
    cues.value.filter((cue, index) =>
      cues.value.some((other, otherIndex) => otherIndex !== index && other.time === cue.time && other.scene === cue.scene),
    ),
  )

  const activeBatch = computed(() => batch.value)
  const batchNo = computed(() => batch.value?.batchNo ?? 0)
  const currentVenue = computed<Venue>(() => batch.value?.toVenue ?? { ...seedVenue })
  const pendingConflicts = computed(() => batch.value?.conflicts.filter((conflict) => !conflict.resolved) ?? [])
  const hasPendingConflicts = computed(() => pendingConflicts.value.length > 0)
  const stagedCount = computed(() => batch.value?.stagedChanges.filter((change) => !change.acked).length ?? 0)
  const writeFailed = computed(() => batch.value?.writeState === 'failed')
  const isWriting = computed(() => batch.value?.writeState === 'writing')
  const writeError = computed(() => batch.value?.writeError ?? null)

  const canPrint = computed(() => {
    if (!batch.value) return true
    if (!batch.value.tablesValid) return false
    if (pendingConflicts.value.length > 0) return false
    return true
  })

  const printBlockReason = computed<string | null>(() => {
    if (!batch.value) return null
    if (!batch.value.tablesValid) return '出表已失效：场馆或提示变更后需重新生成出表'
    if (pendingConflicts.value.length > 0) return `有 ${pendingConflicts.value.length} 项字段冲突未裁决，裁决前禁止打印`
    return null
  })

  const confirmationsInvalid = computed(() => !!batch.value && !batch.value.confirmationsValid)
  const tablesInvalid = computed(() => !!batch.value && !batch.value.tablesValid)

  watch(
    [cues, rev, isOffline, batch, baselines],
    () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          cues: cues.value,
          revision: rev.value,
          batch: batch.value,
          baselines: baselines.value,
        }),
      )
      lastSaved.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    },
    { deep: true },
  )

  function snapshot() {
    undoStack.value.push(deepClone(cues.value))
    if (undoStack.value.length > 20) undoStack.value.shift()
    redoStack.value = []
  }

  function touchBatch() {
    if (!batch.value) return
    batch.value.confirmationsValid = false
    batch.value.tablesValid = false
  }

  function recordStaged(cueId: string, field: string, oldValue: unknown, newValue: unknown) {
    if (!isOffline.value || !batch.value) return
    batch.value.stagedChanges.push({
      id: `SC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      cueId,
      field,
      oldValue,
      newValue,
      at: new Date().toISOString(),
      acked: false,
    })
  }

  function updateCue(patch: Partial<Cue>, addRevision = true) {
    if (locked.value) return
    snapshot()
    const index = cues.value.findIndex((cue) => cue.id === selectedId.value)
    if (index < 0) return
    const old = cues.value[index]
    cues.value[index] = { ...old, ...patch }
    if (addRevision) rev.value += 1
    if (batch.value) {
      for (const field of Object.keys(patch)) {
        recordStaged(old.id, field, (old as Record<string, unknown>)[field], (patch as Record<string, unknown>)[field])
      }
      touchBatch()
    }
  }

  function addWaypoint(point: { x: number; y: number }) {
    const cue = selectedCue.value
    if (!cue) return
    updateCue({ route: [...cue.route, point] })
  }

  function addCue() {
    if (locked.value) return
    snapshot()
    const next = cues.value.length + 1
    const cue: Cue = {
      id: `C-${String(next).padStart(2, '0')}`,
      act: '第一幕',
      scene: '新场景',
      time: '00:00:00',
      title: '新执行提示',
      department: '舞台',
      owner: '待指派',
      duration: 30,
      entry: { x: 10, y: 50 },
      exit: { x: 90, y: 50 },
      route: [{ x: 10, y: 50 }, { x: 90, y: 50 }],
      note: '',
      status: '草稿',
      comments: [],
    }
    cues.value.push(cue)
    selectedId.value = cue.id
    rev.value += 1
    if (batch.value) {
      recordStaged(cue.id, '*', null, cue)
      touchBatch()
    }
  }

  function undo() {
    const previous = undoStack.value.pop()
    if (!previous) return
    redoStack.value.push(deepClone(cues.value))
    cues.value = previous
    if (batch.value) batch.value.cues = cues.value
    rev.value += 1
  }

  function redo() {
    const next = redoStack.value.pop()
    if (!next) return
    undoStack.value.push(deepClone(cues.value))
    cues.value = next
    if (batch.value) batch.value.cues = cues.value
    rev.value += 1
  }

  function addComment(content: string, author = '当前用户') {
    const cue = selectedCue.value
    if (!cue) return
    snapshot()
    const comment: Comment = {
      id: `local-${Date.now()}`,
      author,
      content,
      createdAt: new Date().toLocaleString('zh-CN'),
      resolved: false,
    }
    cue.comments.push(comment)
    rev.value += 1
    if (batch.value) {
      recordStaged(cue.id, 'comments', null, comment)
      touchBatch()
    }
  }

  function toggleComment(commentId: string) {
    const comment = selectedCue.value?.comments.find((item) => item.id === commentId)
    if (comment) comment.resolved = !comment.resolved
  }

  function lockBaseline() {
    locked.value = true
    cues.value.forEach((cue) => {
      cue.status = '已确认'
    })
    rev.value += 1
  }

  function unlockBaseline() {
    locked.value = false
    rev.value += 1
  }

  function toggleOffline() {
    isOffline.value = !isOffline.value
  }

  function finalizeCity(venue: { name: string; width: number; depth: number }) {
    if (!batch.value) return
    const snapshot: BaselineSnapshot = {
      id: `BL-${batch.value.batchNo}-${Date.now()}`,
      batchNo: batch.value.batchNo,
      venue: { ...batch.value.toVenue },
      frozenAt: new Date().toISOString(),
      revision: revision.value,
      cues: deepClone(cues.value),
    }
    baselines.value.push(snapshot)

    const newCues = deepClone(cues.value)
    const newBatch: CityBatch = {
      batchNo: batch.value.batchNo + 1,
      fromVenue: { ...batch.value.toVenue },
      toVenue: { ...venue },
      status: 'active',
      startedAt: new Date().toISOString(),
      cues: newCues,
      batchStartCues: deepClone(newCues),
      baseline: snapshot,
      stagedChanges: [],
      conflicts: [],
      writeState: 'idle',
      writeError: null,
      confirmationsValid: true,
      tablesValid: true,
      lastSyncedAt: null,
    }
    cues.value = newCues
    batch.value = newBatch
    rev.value += 1
  }

  function updateVenueSize(width: number, depth: number) {
    if (!batch.value) return
    batch.value.toVenue.width = width
    batch.value.toVenue.depth = depth
    touchBatch()
    rev.value += 1
  }

  function applyMerge(remoteCues: Cue[]) {
    if (!batch.value) return
    const { cues: merged, conflicts: newConflicts } = mergeBatch(batch.value.batchStartCues, cues.value, remoteCues)
    const existingKeys = new Set(batch.value.conflicts.map((conflict) => `${conflict.cueId}:${conflict.field}`))
    for (const conflict of newConflicts) {
      if (!existingKeys.has(`${conflict.cueId}:${conflict.field}`)) {
        batch.value.conflicts.push(conflict)
      }
    }
    batch.value.cues = merged
    cues.value = merged
  }

  async function syncBatch(remoteOverride?: Cue[]) {
    if (!batch.value) return
    batch.value.writeState = 'writing'
    batch.value.writeError = null
    try {
      let remoteCues = remoteOverride
      if (!remoteCues) {
        try {
          const { data } = await axios.get<Cue[]>('/api/city-batch/remote', {
            params: { batchNo: batch.value.batchNo },
          })
          remoteCues = data
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 404) {
            const { data: established } = await axios.post<{ remoteCues: Cue[] }>('/api/city-batch/finalize', {
              batchNo: batch.value.batchNo,
              fromVenue: batch.value.fromVenue,
              toVenue: batch.value.toVenue,
              cues: deepClone(batch.value.batchStartCues),
            })
            remoteCues = established.remoteCues
          } else {
            throw error
          }
        }
      }
      applyMerge(remoteCues)
      await axios.post('/api/city-batch/sync', {
        batchNo: batch.value.batchNo,
        cues: deepClone(cues.value),
      })
      batch.value.stagedChanges.forEach((change) => {
        change.acked = true
      })
      batch.value.stagedChanges = []
      batch.value.writeState = 'done'
      batch.value.status = 'synced'
      batch.value.lastSyncedAt = new Date().toISOString()
      rev.value += 1
    } catch (error) {
      batch.value.writeState = 'failed'
      batch.value.writeError = error instanceof Error ? error.message : String(error)
    }
  }

  async function resumeBatch() {
    if (!batch.value) return
    const hasUnacked = batch.value.stagedChanges.some((change) => !change.acked)
    if (!hasUnacked && batch.value.writeState !== 'failed') return
    await syncBatch()
  }

  function resolveConflict(cueId: string, field: string, chosen: 'local' | 'remote') {
    if (!batch.value) return
    const conflict = batch.value.conflicts.find((item) => item.cueId === cueId && item.field === field)
    if (!conflict || conflict.resolved) return
    conflict.chosen = chosen
    conflict.resolved = true
    if (chosen === 'remote') {
      const cue = cues.value.find((item) => item.id === cueId)
      if (cue) {
        if (field === 'route') {
          cue.route = deepClone(conflict.remote.value as Point[])
        } else if (field === 'entry' || field === 'exit') {
          ;(cue as Record<string, unknown>)[field] = deepClone(conflict.remote.value)
        } else {
          ;(cue as Record<string, unknown>)[field] = deepClone(conflict.remote.value)
        }
      }
    }
    rev.value += 1
  }

  function confirmAll() {
    if (!batch.value) return
    batch.value.confirmationsValid = true
    rev.value += 1
  }

  function generateTables() {
    if (!batch.value) return
    batch.value.tablesValid = true
    rev.value += 1
  }

  function viewBaseline(snapshot: BaselineSnapshot) {
    viewingBaseline.value = snapshot
  }

  function closeBaseline() {
    viewingBaseline.value = null
  }

  return {
    cues,
    selectedId,
    selectedCue,
    filteredCues,
    conflicts,
    zoom,
    actFilter,
    departmentFilter,
    revision,
    lastSaved,
    isOffline,
    locked,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    batch,
    baselines,
    viewingBaseline,
    activeBatch,
    batchNo,
    currentVenue,
    pendingConflicts,
    hasPendingConflicts,
    stagedCount,
    writeFailed,
    isWriting,
    writeError,
    canPrint,
    printBlockReason,
    confirmationsInvalid,
    tablesInvalid,
    updateCue,
    addWaypoint,
    addCue,
    undo,
    redo,
    addComment,
    toggleComment,
    lockBaseline,
    unlockBaseline,
    toggleOffline,
    finalizeCity,
    updateVenueSize,
    syncBatch,
    resumeBatch,
    resolveConflict,
    confirmAll,
    generateTables,
    viewBaseline,
    closeBaseline,
  }
})
