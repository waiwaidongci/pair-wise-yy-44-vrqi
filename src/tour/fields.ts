// 换城批次的纯逻辑：字段相等、三路合并、出表签名、待写入计算
import type { Cue } from '../stores/workshop'
import { MERGE_FIELDS, type CityBatch, type CueMergeState, type FieldState, type MergeField } from './types'

/** 深度结构相等（坐标点 / 路线数组 / 原始值均覆盖） */
export function fieldEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a && b && typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

export function cloneFieldValue<T>(value: T): T {
  // 入参可能是 Vue 响应式代理，structuredClone 无法克隆；字段值均可 JSON 序列化
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

function now(): string {
  return new Date().toISOString()
}

/** 初始化一条提示的字段状态：全部字段都以冻结基线为旧值 */
export function initCueState(cue: Cue): CueMergeState {
  const fields = {} as CueMergeState['fields']
  for (const field of MERGE_FIELDS) {
    fields[field] = {
      status: '未改',
      base: cloneFieldValue(cue[field]),
      local: undefined,
      remote: undefined,
      resolved: undefined,
      sources: [],
      updatedAt: '',
    }
  }
  return { cueId: cue.id, fields, status: '待处理', written: false, lastError: '', updatedAt: '' }
}

/** 记录一条断网本地暂存改动（只改状态，不触碰冻结基线） */
export function applyLocalEdit(state: CueMergeState, field: MergeField, value: unknown, at = now()): CueMergeState {
  const fs = state.fields[field]
  if (!fs) return state
  // 与旧值一致视为撤回改动
  if (fieldEqual(value, fs.base)) {
    return {
      ...state,
      fields: { ...state.fields, [field]: { ...fs, local: undefined, status: fs.remote !== undefined ? '远端已改' : '未改', sources: fs.remote !== undefined ? ['远端协作'] : [], updatedAt: at } },
      updatedAt: at,
    }
  }
  const sources: FieldState['sources'] = fs.remote !== undefined ? ['本地暂存', '远端协作'] : ['本地暂存']
  const status: FieldState['status'] = fs.remote !== undefined ? '冲突待裁决' : '本地已改'
  return {
    ...state,
    fields: {
      ...state.fields,
      [field]: { ...fs, local: cloneFieldValue(value), status, sources, updatedAt: at },
    },
    // 已写入后再改，需要重新写入
    written: false,
    lastError: '',
    updatedAt: at,
  }
}

/** 模拟"远端协作方"在服务器上的改动（另一舞台监督/灯控在另一终端提交） */
export function applyRemoteEdit(state: CueMergeState, field: MergeField, value: unknown, at = now()): CueMergeState {
  const fs = state.fields[field]
  if (!fs) return state
  if (fieldEqual(value, fs.base)) {
    return {
      ...state,
      fields: { ...state.fields, [field]: { ...fs, remote: undefined, status: fs.local !== undefined ? '本地已改' : '未改', sources: fs.local !== undefined ? ['本地暂存'] : [], updatedAt: at } },
      updatedAt: at,
    }
  }
  const sources: FieldState['sources'] = fs.local !== undefined ? ['本地暂存', '远端协作'] : ['远端协作']
  const status: FieldState['status'] = fs.local !== undefined ? '冲突待裁决' : '远端已改'
  return {
    ...state,
    fields: {
      ...state.fields,
      [field]: { ...fs, remote: cloneFieldValue(value), status, sources, updatedAt: at },
    },
    written: false,
    lastError: '',
    updatedAt: at,
  }
}

/**
 * 联网后按字段三路合并：
 * - 只本地改：采纳本地
 * - 只远端改：采纳远端
 * - 两边都改且内容一致：自动合并
 * - 两边都改且内容不同：保留两版来源，置「冲突待裁决」，必须人工裁决
 */
export function mergeCueState(state: CueMergeState, at = now()): CueMergeState {
  const fields = { ...state.fields }
  let hasConflict = false
  let hasChange = false

  for (const field of MERGE_FIELDS) {
    const fs = fields[field]!
    if (fs.status === '已合并') continue
    const localChanged = fs.local !== undefined
    const remoteChanged = fs.remote !== undefined
    if (!localChanged && !remoteChanged) continue
    hasChange = true

    if (localChanged && !remoteChanged) {
      fields[field] = { ...fs, status: '已合并', resolved: cloneFieldValue(fs.local), sources: ['本地暂存'], updatedAt: at }
    } else if (!localChanged && remoteChanged) {
      fields[field] = { ...fs, status: '已合并', resolved: cloneFieldValue(fs.remote), sources: ['远端协作'], updatedAt: at }
    } else {
      // 两边都改
      if (fieldEqual(fs.local, fs.remote)) {
        fields[field] = { ...fs, status: '已合并', resolved: cloneFieldValue(fs.local), sources: ['本地暂存', '远端协作'], updatedAt: at }
      } else {
        hasConflict = true
        fields[field] = { ...fs, status: '冲突待裁决', sources: ['本地暂存', '远端协作'], resolved: undefined, updatedAt: at }
      }
    }
  }

  const status: CueMergeState['status'] = !hasChange ? state.status : hasConflict ? '待裁决' : '待写入'
  return { ...state, fields, status, updatedAt: at }
}

/** 舞台监督对双改字段做裁决：pick 选择保留哪一版来源 */
export function resolveField(
  state: CueMergeState,
  field: MergeField,
  pick: '本地暂存' | '远端协作',
  at = now(),
): CueMergeState {
  const fs = state.fields[field]
  if (!fs || fs.status !== '冲突待裁决') return state
  const value = pick === '本地暂存' ? fs.local : fs.remote
  return {
    ...state,
    fields: { ...state.fields, [field]: { ...fs, status: '已合并', resolved: cloneFieldValue(value), sources: [pick], updatedAt: at } },
    written: false,
    lastError: '',
    updatedAt: at,
  }
}

/** 重新计算一条提示的汇总状态（裁决完所有冲突后变待写入） */
export function recomputeCueStatus(state: CueMergeState): CueMergeState {
  const entries = MERGE_FIELDS.map((f) => state.fields[f]!).filter((fs) => fs.status !== '未改')
  if (entries.some((fs) => fs.status === '冲突待裁决')) return { ...state, status: '待裁决' }
  const merged = entries.filter((fs) => fs.status === '已合并' || fs.status === '本地已改' || fs.status === '远端已改')
  if (merged.length === 0) return { ...state, status: '待处理' }
  if (state.written) return { ...state, status: '已写入' }
  return { ...state, status: '待写入' }
}

/** 批次里是否还存在待裁决的双改字段 —— 未裁决前不能打印 */
export function batchHasConflicts(batch: CityBatch): boolean {
  return Object.values(batch.cueStates).some((cs) =>
    MERGE_FIELDS.some((f) => cs.fields[f]?.status === '冲突待裁决'),
  )
}

/** 待写入提示：恢复继续时只补这些，已写入的不再重复，保证不重复产生基线 */
export function pendingWriteCueIds(batch: CityBatch): string[] {
  return batch.writeOrder.filter((id) => {
    const cs = batch.cueStates[id]
    if (!cs || cs.written) return false
    return MERGE_FIELDS.some((f) => {
      const s = cs.fields[f]!.status
      return s === '已合并'
    })
  })
}

/** 把合并结果应用到一条提示上，返回新提示（不可变更新） */
export function buildMergedCue(baseCue: Cue, state: CueMergeState): Cue {
  const patch: Partial<Cue> = {}
  for (const field of MERGE_FIELDS) {
    const fs = state.fields[field]!
    if (fs.status === '已合并') patch[field] = cloneFieldValue(fs.resolved) as never
  }
  return { ...baseCue, ...patch }
}

/**
 * 出表签名：覆盖场馆尺寸与全部字段的裁决/合并结果。
 * 场馆尺寸或任一字段变化都会改变签名，使既有确认与出表失效。
 */
export function computeSignature(batch: Pick<CityBatch, 'venue' | 'cueStates'>, baselineCues: Cue[]): string {
  const parts: Array<string | number> = [batch.venue.venueName, batch.venue.widthM, batch.venue.depthM]
  for (const cue of baselineCues) {
    const cs = batch.cueStates[cue.id]
    parts.push(cue.id)
    for (const field of MERGE_FIELDS) {
      const fs = cs?.fields[field]
      if (!fs) {
        parts.push(field, JSON.stringify(cue[field] ?? null))
      } else if (fs.status === '冲突待裁决') {
        parts.push(field, 'CONFLICT', JSON.stringify(fs.local ?? null), JSON.stringify(fs.remote ?? null))
      } else if (fs.status === '已合并') {
        parts.push(field, 'MERGED', JSON.stringify(fs.resolved ?? null))
      } else {
        parts.push(field, 'BASE', JSON.stringify(fs.base ?? null))
      }
    }
  }
  // 轻量 FNV-1a，无需加密强度，只需对变化敏感
  let hash = 0x811c9dc5
  const text = parts.join('|')
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 打印闸门：裁决全部完成、已确认、且确认后场馆/字段无变化，才允许打印 */
export function canPrint(batch: CityBatch | null, baselineCues: Cue[]): { ok: boolean; reason: string } {
  if (!batch) return { ok: false, reason: '尚无换城批次' }
  if (batch.phase === '待定稿') return { ok: false, reason: '新场馆尚未定稿，旧提示未冻结' }
  if (batchHasConflicts(batch)) return { ok: false, reason: '存在双改字段待裁决，裁决前不能打印' }
  if (pendingWriteCueIds(batch).length > 0 || batch.phase === '写入失败' || batch.phase === '写入中') {
    return { ok: false, reason: '仍有提示未完成写入，请先继续未完成批次' }
  }
  const sig = computeSignature(batch, baselineCues)
  if (!batch.confirmed) return { ok: false, reason: '舞台监督尚未确认本批次' }
  if (sig !== batch.confirmedSignature) {
    return { ok: false, reason: '场馆尺寸或字段在确认后发生变化，确认已失效，请重新确认' }
  }
  return { ok: true, reason: '可打印' }
}
