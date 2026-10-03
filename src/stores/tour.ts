import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useWorkshopStore, type Cue } from './workshop'
import {
  applyLocalEdit,
  applyRemoteEdit,
  batchHasConflicts,
  buildMergedCue,
  canPrint,
  computeSignature,
  initCueState,
  mergeCueState,
  pendingWriteCueIds,
  recomputeCueStatus,
  resolveField,
} from '../tour/fields'
import type { Baseline, CityBatch, CueMergeState, FieldSource, MergeField, VenueDims } from '../tour/types'
import { commitCueWrite } from '../api/tour'

const STORAGE_KEY = 'stage-scheduler-tour-v1'

/**
 * 深拷贝。批次数据全部可 JSON 序列化（坐标/路线/留言/字段状态），
 * 且来源可能是 Vue 响应式代理（structuredClone 无法克隆 Proxy）。
 */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
/** 首版旧稿假定的上测场馆（仅用于按宽深缩放走位的参照） */
const LEGACY_DIMS = { venueName: '上海大剧院 · 大剧场', widthM: 16, depthM: 12 }

type RemoteEdit = { cueId: string; field: MergeField; value: unknown }
type Persisted = {
  baselines: Baseline[]
  batches: CityBatch[]
  activeBatchId: string
  seq: number
  migrated: boolean
  remoteQueue: Record<string, RemoteEdit[]>
  failNext: number
}

/** 断网期间"另一终端"提交到服务器的协作改动（演示夹具，按批次暂存） */
function buildRemoteFixture(cues: Cue[]): RemoteEdit[] {
  const byId = new Map(cues.map((cue) => [cue.id, cue]))
  const edits: RemoteEdit[] = []
  const c1 = byId.get('C-01')
  if (c1) edits.push({ cueId: 'C-01', field: 'note', value: `${c1.note}【远端·王灯控】面光在新场馆延长至 6 秒，入场位随台深后移 1 米。` })
  const c4 = byId.get('C-04')
  if (c4) edits.push({ cueId: 'C-04', field: 'time', value: '00:23:08' })
  return edits
}

function load(): Partial<Persisted> | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw ? (JSON.parse(raw) as Persisted) : null
}

export const useTourStore = defineStore('tour', () => {
  const workshop = useWorkshopStore()
  const persisted = load()

  const baselines = ref<Baseline[]>(persisted?.baselines ?? [])
  const batches = ref<CityBatch[]>(persisted?.batches ?? [])
  const activeBatchId = ref<string>(persisted?.activeBatchId ?? '')
  const seq = ref(persisted?.seq ?? 0)
  const migrated = ref(persisted?.migrated ?? false)
  /** 各批次断网期间到达的远端改动队列 */
  const remoteQueue = ref<Record<string, RemoteEdit[]>>(persisted?.remoteQueue ?? {})
  /** 接下来的第 N 次写入返回失败（舞台监督可手动注入，验证可恢复） */
  const failNext = ref(persisted?.failNext ?? 0)
  const isOffline = ref(false)
  const networkNote = ref('协作服务正常')
  const writing = ref(false)

  // 旧稿缺批次号 → 升级为「首版」，原路线与留言原样保留
  if (!migrated.value && baselines.value.length === 0) {
    const stamp = new Date().toISOString()
    baselines.value = [
      {
        id: 'BL-001',
        batchId: 'B-000',
        label: '首版（旧稿升级）',
        venueName: LEGACY_DIMS.venueName,
        widthM: LEGACY_DIMS.widthM,
        depthM: LEGACY_DIMS.depthM,
        frozenAt: stamp,
        cues: deepClone(workshop.cues),
      },
    ]
    migrated.value = true
  }
  persist()

  // 刷新后按持久化的活动批次恢复工作区冻结锁（定稿后到确认前旧提示只读）
  {
    const active = batches.value.find((b) => b.id === activeBatchId.value)
    if (active && ['调整中', '待裁决', '待写入', '写入中', '写入失败', '待确认'].includes(active.phase)) {
      workshop.tourFrozen = true
      workshop.locked = true
    }
  }

  function persist() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        baselines: baselines.value,
        batches: batches.value,
        activeBatchId: activeBatchId.value,
        seq: seq.value,
        migrated: migrated.value,
        remoteQueue: remoteQueue.value,
        failNext: failNext.value,
      } satisfies Persisted),
    )
  }

  // 兜底持久化（显式 persist 已覆盖关键变更，这里保证状态派生变化也会落盘）
  watch(
    [baselines, batches, activeBatchId, seq, migrated, remoteQueue, failNext],
    () => persist(),
    { deep: true },
  )

  const activeBatch = computed<CityBatch | null>(
    () => batches.value.find((batch) => batch.id === activeBatchId.value) ?? null,
  )
  const latestBaseline = computed<Baseline | null>(() => baselines.value[baselines.value.length - 1] ?? null)

  const baselineCuesOf = (batch: CityBatch | null): Cue[] => {
    if (!batch) return latestBaseline.value?.cues ?? workshop.cues
    return baselines.value.find((b) => b.id === batch.fromBaselineId)?.cues ?? []
  }

  const frozenCues = computed<Cue[]>(() => baselineCuesOf(activeBatch.value))

  /** 合并生效后的提示（未写入/未合并字段沿用冻结旧值） */
  const mergedCues = computed<Cue[]>(() => {
    const batch = activeBatch.value
    const base = frozenCues.value
    if (!batch) return base
    return base.map((cue) => {
      const state = batch.cueStates[cue.id]
      return state ? buildMergedCue(cue, state) : cue
    })
  })

  const currentSignature = computed(() =>
    activeBatch.value ? computeSignature(activeBatch.value, frozenCues.value) : '',
  )
  const confirmationValid = computed(() => {
    const batch = activeBatch.value
    return !!batch && batch.confirmed && batch.confirmedSignature === currentSignature.value
  })
  const conflictCount = computed(() => {
    const batch = activeBatch.value
    if (!batch) return 0
    let n = 0
    for (const cs of Object.values(batch.cueStates)) {
      for (const f of Object.values(cs.fields)) if (f?.status === '冲突待裁决') n += 1
    }
    return n
  })
  const pendingWrites = computed(() => (activeBatch.value ? pendingWriteCueIds(activeBatch.value) : []))
  const printGate = computed(() => canPrint(activeBatch.value, frozenCues.value))

  /** 打印中心实际出表内容：批次完成用合并结果，否则用最近基线（进行中批次会被闸门拦下） */
  const printCues = computed<Cue[]>(() => {
    const batch = activeBatch.value
    if (batch && (batch.phase === '待确认' || batch.phase === '已完成')) return mergedCues.value
    return latestBaseline.value?.cues ?? workshop.cues
  })

  function patchBatch(patch: Partial<CityBatch>) {
    const index = batches.value.findIndex((b) => b.id === activeBatchId.value)
    if (index >= 0) batches.value[index] = { ...batches.value[index], ...patch }
    persist()
  }

  function patchCueState(cueId: string, next: CueMergeState) {
    const batch = activeBatch.value
    if (!batch) return
    patchBatch({ cueStates: { ...batch.cueStates, [cueId]: next } })
  }

  /** 建立换城批次（场馆尺寸待定稿，此步不冻结） */
  function startBatch(venue: VenueDims): string {
    const open = batches.value.find((b) => !['已完成', '已废弃'].includes(b.phase))
    if (open) throw new Error(`批次 ${open.id} 尚未完成，请先继续或确认`)
    if (!latestBaseline.value) throw new Error('缺少首版基线')
    seq.value += 1
    const id = `B-${String(seq.value).padStart(3, '0')}`
    const base = latestBaseline.value
    const batch: CityBatch = {
      id,
      seq: seq.value,
      phase: '待定稿',
      fromBaselineId: base.id,
      venue: deepClone(venue),
      finalizedAt: '',
      createdAt: new Date().toISOString(),
      cueStates: {},
      staged: [],
      writeOrder: base.cues.map((cue) => cue.id),
      remoteEditedAt: '',
      completedAt: '',
      signature: '',
      confirmed: false,
      confirmedSignature: '',
      error: '',
    }
    batches.value.push(batch)
    activeBatchId.value = id
    persist()
    return id
  }

  /**
   * 新场馆定稿：冻结上一城提示（只置状态、不改文字）。
   * 上一城基线已存在（首版升级或上一批次完成时冻结），这里复用其不可变快照，
   * 不重复产生基线；之后走位/灯光音响调整都发生在批次字段状态里。
   */
  function finalizeVenue() {
    const batch = activeBatch.value
    if (!batch || batch.phase !== '待定稿') return
    const stamp = new Date().toISOString()
    const base = latestBaseline.value!
    const cueStates: CityBatch['cueStates'] = {}
    for (const cue of base.cues) cueStates[cue.id] = initCueState(cue)
    patchBatch({
      phase: '调整中',
      fromBaselineId: base.id,
      finalizedAt: stamp,
      cueStates,
      writeOrder: base.cues.map((c) => c.id),
    })
    // 锁定只改状态：旧提示在工作区进入只读，不修改任何字段
    workshop.tourFrozen = true
    workshop.locked = true
  }

  /** 断网/联网切换只换状态文字，不触碰任何数据；同步侧边栏全局指示灯 */
  function toggleOffline() {
    isOffline.value = !isOffline.value
    networkNote.value = isOffline.value ? '已断网：修改先暂存，联网后按字段合并' : '协作服务正常'
    workshop.isOffline = isOffline.value
  }

  function editVenue(patch: Partial<VenueDims>) {
    const batch = activeBatch.value
    if (!batch || ['已完成', '已废弃', '写入中'].includes(batch.phase)) return
    patchBatch({ venue: { ...batch.venue, ...patch } })
    if (batch.confirmed) patchBatch({ confirmed: false, error: '场馆尺寸已变化，原确认失效，请重新确认' })
  }

  /** 本地（断网暂存或在线调整）改一个字段；冻结基线永不被修改 */
  function editField(cueId: string, field: MergeField, value: unknown) {
    const batch = activeBatch.value
    if (!batch || batch.phase !== '调整中') return
    const state = batch.cueStates[cueId]
    if (!state) return
    const at = new Date().toISOString()
    const next = applyLocalEdit(state, field, value, at)
    patchCueState(cueId, next)
    const staged = batch.staged.filter((c) => !(c.cueId === cueId && c.field === field))
    staged.push({ cueId, field, value, at })
    patchBatch({ staged, confirmed: false })
  }

  /** 按新场馆宽深自动缩放选中提示的走位（入/出/路线），逐字段暂存 */
  function rescaleCue(cueId: string) {
    const batch = activeBatch.value
    if (!batch || batch.phase !== '调整中') return
    const from = baselines.value.find((b) => b.id === batch.fromBaselineId)
    if (!from) return
    const sx = batch.venue.widthM / from.widthM
    const sy = batch.venue.depthM / from.depthM
    const cue = frozenCues.value.find((c) => c.id === cueId)
    if (!cue) return
    const scale = (p: { x: number; y: number }) => ({ x: Math.round(p.x * sx * 10) / 10, y: Math.round(p.y * sy * 10) / 10 })
    editField(cueId, 'entry', scale(cue.entry))
    editField(cueId, 'exit', scale(cue.exit))
    editField(cueId, 'route', cue.route.map(scale))
  }

  /** 模拟断网期间远端协作方到达服务器的改动 */
  function simulateRemoteEdits() {
    const batch = activeBatch.value
    if (!batch || !isOffline.value || batch.phase !== '调整中') return
    const queue = remoteQueue.value[batch.id] ?? []
    const existing = new Set(queue.map((e) => `${e.cueId}.${e.field}`))
    for (const edit of buildRemoteFixture(frozenCues.value)) {
      if (!existing.has(`${edit.cueId}.${edit.field}`)) queue.push(edit)
    }
    remoteQueue.value = { ...remoteQueue.value, [batch.id]: queue }
    persist()
  }

  /** 联网：把暂存的本地改动与远端改动按字段合并 */
  function reconnectAndMerge() {
    const batch = activeBatch.value
    if (!batch) return
    isOffline.value = false
    networkNote.value = '协作服务正常'
    if (batch.phase !== '调整中') return

    const queue = remoteQueue.value[batch.id] ?? []
    let states = batch.cueStates
    if (queue.length) {
      const at = new Date().toISOString()
      states = deepClone(states)
      for (const edit of queue) {
        if (!states[edit.cueId]) continue
        states[edit.cueId] = applyRemoteEdit(states[edit.cueId], edit.field, edit.value, at)
      }
      remoteQueue.value = { ...remoteQueue.value, [batch.id]: [] }
      persist()
    }

    const at = new Date().toISOString()
    for (const id of Object.keys(states)) states[id] = mergeCueState(states[id], at)

    const hasConflict = Object.values(states).some((cs) => cs.status === '待裁决')
    const mergedAny = pendingWriteCueIds({ ...batch, cueStates: states } as CityBatch).length > 0
    // 无冲突：有合并改动先写入；无字段改动（仅换场馆尺寸）直接进入待确认
    const nextPhase: CityBatch['phase'] = hasConflict ? '待裁决' : mergedAny ? '待写入' : '待确认'
    patchBatch({
      cueStates: states,
      staged: [],
      remoteEditedAt: queue.length ? at : batch.remoteEditedAt,
      phase: nextPhase,
      error: '',
    })
    if (nextPhase === '待确认') patchBatch({ signature: computeSignature(activeBatch.value!, frozenCues.value) })
  }

  /** 在线调整结束后直接进入合并（仅本地改动，无远端） */
  function prepareWritesOnline() {
    const batch = activeBatch.value
    if (!batch || batch.phase !== '调整中' || isOffline.value) return
    const states = deepClone(batch.cueStates)
    const at = new Date().toISOString()
    for (const id of Object.keys(states)) states[id] = mergeCueState(states[id], at)
    const hasConflict = Object.values(states).some((cs) => cs.status === '待裁决')
    const mergedAny = pendingWriteCueIds({ ...batch, cueStates: states } as CityBatch).length > 0
    const nextPhase: CityBatch['phase'] = hasConflict ? '待裁决' : mergedAny ? '待写入' : '待确认'
    patchBatch({ cueStates: states, staged: [], phase: nextPhase })
    if (nextPhase === '待确认') patchBatch({ signature: computeSignature(activeBatch.value!, frozenCues.value) })
  }

  /** 裁决双改字段：保留选定的一版来源 */
  function resolveConflict(cueId: string, field: MergeField, pick: FieldSource) {
    const batch = activeBatch.value
    if (!batch) return
    const next = recomputeCueStatus(resolveField(batch.cueStates[cueId], field, pick))
    const cueStates = { ...batch.cueStates, [cueId]: next }
    const stillConflict = Object.values(cueStates).some((cs) =>
      Object.values(cs.fields).some((f) => f.status === '冲突待裁决'),
    )
    const phase: CityBatch['phase'] = !stillConflict
      ? pendingWriteCueIds({ ...batch, cueStates } as CityBatch).length
        ? '待写入'
        : batch.phase === '待裁决'
          ? '待写入'
          : batch.phase
      : '待裁决'
    patchBatch({ cueStates, phase })
  }

  function armFailure(count = 1) {
    failNext.value += count
    persist()
  }

  /**
   * 逐提示写入（可恢复）：
   * - 已 written 的提示直接跳过，重复继续不重复写、不重复产生基线
   * - 任一失败保留整个批次为「写入失败」，下次继续只补未完成提示
   */
  async function writePending(): Promise<void> {
    const batch = activeBatch.value
    if (!batch || writing.value) return
    if (batch.phase !== '待写入' && batch.phase !== '写入失败') return
    writing.value = true
    patchBatch({ phase: '写入中', error: '' })
    const cues = mergedCues.value

    let current = activeBatch.value!
    let failedAt = ''
    for (const cueId of pendingWriteCueIds(current)) {
      const cue = cues.find((c) => c.id === cueId)!
      const forceFail = failNext.value > 0
      if (forceFail) failNext.value -= 1
      try {
        await commitCueWrite({ batchId: current.id, cueId, cue, forceFail })
        current = activeBatch.value!
        const state = current.cueStates[cueId]
        const cueStates = { ...current.cueStates, [cueId]: { ...state, status: '已写入' as const, written: true, lastError: '' } }
        patchBatch({ cueStates })
        current = activeBatch.value!
      } catch (error) {
        current = activeBatch.value!
        const state = current.cueStates[cueId]
        const message = error instanceof Error ? error.message : '写入失败'
        patchBatch({
          cueStates: { ...current.cueStates, [cueId]: { ...state, status: '写入失败', written: false, lastError: message } },
        })
        failedAt = cueId
        break
      }
    }

    const after = activeBatch.value!
    const remaining = pendingWriteCueIds(after)
    if (remaining.length) {
      patchBatch({
        phase: '写入失败',
        error: failedAt ? `提示 ${failedAt} 写入失败，批次已保留，继续时只补 ${remaining.length} 条未完成提示` : `仍有 ${remaining.length} 条未完成`,
      })
    } else {
      const signature = computeSignature(after, frozenCues.value)
      patchBatch({ phase: '待确认', signature, confirmed: false, confirmedSignature: '', error: '' })
    }
    writing.value = false
  }

  /** 确认批次：无冲突、无未完成写入才可确认；确认即冻结新城基线（每批次仅一次） */
  function confirmBatch() {
    const batch = activeBatch.value
    if (!batch) return
    if (batchHasConflicts(batch)) throw new Error('仍有双改字段未裁决')
    if (pendingWriteCueIds(batch).length) throw new Error('仍有提示未完成写入')
    if (batch.phase !== '待确认') return
    const stamp = new Date().toISOString()
    const signature = computeSignature(batch, frozenCues.value)

    const newBaseline: Baseline = {
      id: `BL-${String(baselines.value.length + 1).padStart(3, '0')}`,
      batchId: batch.id,
      label: `演出基线 · ${batch.venue.venueName}`,
      venueName: batch.venue.venueName,
      widthM: batch.venue.widthM,
      depthM: batch.venue.depthM,
      frozenAt: stamp,
      cues: deepClone(mergedCues.value),
    }
    baselines.value.push(newBaseline)
    patchBatch({ phase: '已完成', completedAt: stamp, signature, confirmed: true, confirmedSignature: signature })
    persist()

    // 新城基线生效：工作区解锁并切换到合并后的提示
    workshop.cues = deepClone(mergedCues.value)
    workshop.tourFrozen = false
    workshop.locked = false
  }

  /** 放弃当前换城批次（场馆方案取消）；已冻结的历史基线保留可查 */
  function closeBatch() {
    const batch = activeBatch.value
    if (!batch || batch.phase === '写入中') return
    patchBatch({ phase: '已废弃', error: '批次已放弃，冻结基线仍可查' })
    activeBatchId.value = ''
    persist()
    const stillOpen = batches.value.some((b) => b.id !== batch.id && !['已完成', '已废弃'].includes(b.phase))
    if (!stillOpen) {
      workshop.tourFrozen = false
      workshop.locked = false
    }
  }

  return {
    // state
    baselines,
    batches,
    activeBatchId,
    isOffline,
    networkNote,
    writing,
    failNext,
    remoteQueue,
    // getters
    activeBatch,
    latestBaseline,
    frozenCues,
    mergedCues,
    printCues,
    currentSignature,
    confirmationValid,
    conflictCount,
    pendingWrites,
    printGate,
    // actions
    startBatch,
    finalizeVenue,
    toggleOffline,
    editVenue,
    editField,
    rescaleCue,
    simulateRemoteEdits,
    reconnectAndMerge,
    prepareWritesOnline,
    resolveConflict,
    armFailure,
    writePending,
    confirmBatch,
    closeBatch,
  }
})
