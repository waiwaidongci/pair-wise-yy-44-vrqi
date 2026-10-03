<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTourStore } from '../stores/tour'
import { MERGE_FIELDS, type BatchPhase, type CueMergeState, type FieldState, type MergeField } from '../tour/types'
import type { Cue } from '../stores/workshop'

const tour = useTourStore()

const newVenueName = ref('杭州大剧院 · 歌剧院')
const newWidth = ref(18)
const newDepth = ref(14)
const selectedCueId = ref('C-01')

const phaseFlow: readonly BatchPhase[] = ['待定稿', '调整中', '待裁决', '待写入', '写入中', '写入失败', '待确认', '已完成']
const phaseIndex = computed(() => {
  const p = tour.activeBatch?.phase
  if (!p) return -1
  if (p === '已废弃') return -1
  return phaseFlow.indexOf(p)
})

const batch = computed(() => tour.activeBatch)
const remotePending = computed(() => (batch.value ? tour.remoteQueue[batch.value.id]?.length ?? 0 : 0))

const editable = computed(() => batch.value?.phase === '调整中')
const frozenCue = computed<Cue | undefined>(() => tour.frozenCues.find((c) => c.id === selectedCueId.value))
const selectedState = computed<CueMergeState | undefined>(() => batch.value?.cueStates[selectedCueId.value])

function startBatch() {
  if (!newVenueName.value.trim()) {
    ElMessage.warning('请先填写新场馆名称')
    return
  }
  const id = tour.startBatch({ venueName: newVenueName.value.trim(), widthM: Number(newWidth.value), depthM: Number(newDepth.value) })
  ElMessage.success(`已创建换城批次 ${id}，定稿后将冻结上一城提示`)
}

function finalize() {
  tour.finalizeVenue()
  ElMessage.success('新场馆已定稿：上一城提示已冻结为基线，开始走位与灯光音响调整')
}

function editField(field: MergeField, raw: unknown) {
  tour.editField(selectedCueId.value, field, raw)
}

function onField(field: string, value: unknown) {
  editField(field as MergeField, value)
}

/** 模板绑定用：生成带字段名的更新回调（参数类型在 setup 内可推断） */
function bindField(field: MergeField) {
  return (value: unknown) => editField(field, value)
}
const bind = {
  time: bindField('time'),
  scene: bindField('scene'),
  title: bindField('title'),
  owner: bindField('owner'),
  duration: bindField('duration'),
  note: bindField('note'),
}

function onVenueName(value: string | number) {
  tour.editVenue({ venueName: String(value) })
}

function onVenueWidth(value: string | number) {
  tour.editVenue({ widthM: Number(value) })
}

function onVenueDepth(value: string | number) {
  tour.editVenue({ depthM: Number(value) })
}

function fieldValue(field: MergeField): unknown {
  const fs = selectedState.value?.fields[field]
  if (!fs) return frozenCue.value?.[field]
  if (fs.status === '已合并') return fs.resolved
  if (fs.local !== undefined && editable.value) return fs.local
  return fs.base
}

function fmt(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (Array.isArray(value)) return value.map((p) => `${p.x},${p.y}`).join(' → ')
  return String(value)
}

function statusTag(status: FieldState['status']) {
  return {
    未改: { type: 'info', text: '未改' },
    本地已改: { type: 'warning', text: '本地暂存' },
    远端已改: { type: 'primary', text: '远端改动' },
    已合并: { type: 'success', text: '已合并' },
    冲突待裁决: { type: 'danger', text: '冲突·待裁决' },
  }[status]
}

function cueRowClass(cs: CueMergeState) {
  return {
    conflict: cs.status === '待裁决',
    written: cs.written,
    failed: cs.status === '写入失败',
  }
}

function cueStatusTag(cs: CueMergeState) {
  return {
    待处理: 'info',
    待写入: 'warning',
    待裁决: 'danger',
    已写入: 'success',
    写入失败: 'danger',
  }[cs.status] as 'info' | 'warning' | 'danger' | 'success'
}

async function mergeOffline() {
  tour.reconnectAndMerge()
  const b = tour.activeBatch
  if (b?.phase === '待裁决') ElMessage.warning('发现双改字段，已保留两版来源，请逐条裁决后才能打印')
  else if (b?.phase === '待写入') ElMessage.success('按字段合并完成，无冲突，可开始写入')
  else ElMessage.success('已联网，无待合并改动')
}

async function mergeOnline() {
  tour.prepareWritesOnline()
  if (tour.activeBatch?.phase === '待写入') ElMessage.success('本地调整已合并，可开始写入')
}

async function injectFailureAndContinue() {
  tour.armFailure(1)
  await write()
}

async function write() {
  try {
    await tour.writePending()
    const b = tour.activeBatch
    if (b?.phase === '写入失败') ElMessage.error(b.error)
    else if (b?.phase === '待确认') ElMessage.success('全部提示写入完成，请确认后生成新城演出基线')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '写入失败')
  }
}

async function confirmBatch() {
  try {
    await ElMessageBox.confirm('确认后将冻结为新场馆演出基线，原冻结基线继续可查。是否确认？', '确认换城批次', {
      confirmButtonText: '确认并冻结',
      cancelButtonText: '再看看',
      type: 'warning',
    })
    tour.confirmBatch()
    ElMessage.success('新场馆演出基线已冻结，打印闸门已打开')
  } catch {
    /* 取消 */
  }
}

function resolve(field: MergeField, pick: '本地暂存' | '远端协作') {
  tour.resolveConflict(selectedCueId.value, field, pick)
}

const conflictingFields = computed(() =>
  selectedState.value ? MERGE_FIELDS.filter((f) => selectedState.value!.fields[f]?.status === '冲突待裁决') : [],
)

const FIELD_LABELS: Record<string, string> = {
  scene: '场景',
  time: '时间码',
  title: '提示标题',
  department: '部门',
  owner: '责任角色',
  duration: '时长',
  note: '执行说明',
  entry: '入场点',
  exit: '退场点',
  route: '路线节点',
}
function fieldLabel(f: string) {
  return FIELD_LABELS[f] ?? f
}

/** 断网时一键演示：另一终端提交远端改动 → 恢复联网 → 按字段三路合并 */
function simulateRemoteThenMerge() {
  tour.simulateRemoteEdits()
  ElMessage.info('已模拟远端协作改动，正在恢复联网合并')
  mergeOffline()
}
</script>

<template>
  <section class="page tour-page">
    <div class="page-head">
      <div>
        <p class="eyebrow">TOUR CHANGE / 换城批次</p>
        <h1>可恢复的换城批次</h1>
        <p class="muted">新场馆定稿冻结旧提示；断网改动先暂存，联网按字段合并；双改字段裁决前不能打印。</p>
      </div>
      <div class="actions">
        <el-tag :type="tour.isOffline ? 'warning' : 'success'" effect="dark">
          {{ tour.isOffline ? `离线 · ${remotePending} 条远端改动待合并` : '在线' }}
        </el-tag>
        <el-button :type="tour.isOffline ? 'success' : 'info'" plain @click="tour.toggleOffline">
          {{ tour.isOffline ? '恢复联网' : '模拟离线' }}
        </el-button>
      </div>
    </div>

    <!-- 步骤条 -->
    <div class="panel phase-bar">
      <template v-for="(label, i) in phaseFlow" :key="label">
        <div class="phase-node" :class="{ active: i === phaseIndex, done: i < phaseIndex }">
          <i>{{ i + 1 }}</i><span>{{ label }}</span>
        </div>
        <b v-if="i < phaseFlow.length - 1" class="phase-line" :class="{ done: i < phaseIndex }" />
      </template>
    </div>

    <el-alert
      v-if="batch?.error"
      class="batch-alert"
      :type="batch.phase === '写入失败' ? 'error' : 'warning'"
      show-icon
      :closable="false"
      :title="batch.error"
    />

    <!-- 无批次：建立换城批次 -->
    <section v-if="!batch" class="panel start-panel">
      <div class="panel-head"><h3>新建换城批次</h3><span class="muted">定稿时才冻结旧提示</span></div>
      <div class="start-form">
        <el-form label-position="top">
          <el-form-item label="新场馆名称">
            <el-input v-model="newVenueName" placeholder="如：杭州大剧院 · 歌剧院" style="width: 260px" />
          </el-form-item>
          <div class="dims-row">
            <el-form-item label="台口宽（米）">
              <el-input-number v-model="newWidth" :min="4" :max="60" :step="0.5" />
            </el-form-item>
            <el-form-item label="台深（米）">
              <el-input-number v-model="newDepth" :min="4" :max="60" :step="0.5" />
            </el-form-item>
          </div>
        </el-form>
        <div class="start-side">
          <p>上一城基线：<strong>{{ tour.latestBaseline?.label }}</strong></p>
          <p class="muted">{{ tour.latestBaseline?.venueName }} · {{ tour.latestBaseline?.widthM }}×{{ tour.latestBaseline?.depthM }} 米 · {{ tour.latestBaseline?.cues.length }} 条提示</p>
          <el-button type="primary" size="large" @click="startBatch">创建换城批次</el-button>
        </div>
      </div>

      <div class="archive">
        <div class="panel-head"><h3>演出基线档案（原路线与留言持续可查）</h3></div>
        <div v-for="bl in tour.baselines" :key="bl.id" class="baseline-row">
          <el-tag size="small" :type="bl.label.startsWith('首版') ? 'info' : 'success'" effect="plain">{{ bl.id }} · {{ bl.batchId }}</el-tag>
          <strong>{{ bl.label }}</strong>
          <span class="muted">{{ bl.venueName }} · {{ bl.widthM }}×{{ bl.depthM }}m · {{ bl.cues.length }} 条</span>
          <time>{{ new Date(bl.frozenAt).toLocaleString('zh-CN') }}</time>
        </div>
      </div>
    </section>

    <template v-else>
      <div class="tour-grid">
        <!-- 左：批次与场馆 -->
        <div class="left-col">
          <section class="panel">
            <div class="panel-head">
              <h3>{{ batch.id }} · 场馆尺寸</h3>
              <el-tag size="small" effect="plain">{{ batch.phase }}</el-tag>
            </div>
            <div class="venue-form">
              <el-form label-position="top" :disabled="!editable">
                <el-form-item label="场馆名称">
                  <el-input :model-value="batch.venue.venueName" @update:model-value="onVenueName" />
                </el-form-item>
                <div class="dims-row">
                  <el-form-item label="台口宽（米）">
                    <el-input-number :model-value="batch.venue.widthM" :min="4" :max="60" :step="0.5" @update:model-value="onVenueWidth" />
                  </el-form-item>
                  <el-form-item label="台深（米）">
                    <el-input-number :model-value="batch.venue.depthM" :min="4" :max="60" :step="0.5" @update:model-value="onVenueDepth" />
                  </el-form-item>
                </div>
              </el-form>
              <el-button v-if="batch.phase === '待定稿'" type="primary" @click="finalize">定稿并冻结上一城提示</el-button>
              <el-button v-else-if="editable && batch.phase === '调整中'" @click="tour.rescaleCue(selectedCueId)">按宽深缩放当前走位</el-button>
              <el-button v-if="!['已完成', '写入中'].includes(batch.phase)" text type="danger" @click="tour.closeBatch">放弃批次</el-button>
            </div>
          </section>

          <!-- 字段编辑（仅调整中） -->
          <section v-if="frozenCue" class="panel">
            <div class="panel-head">
              <h3>走位与提示调整 · {{ frozenCue.id }}</h3>
              <el-tag size="small" :type="editable ? 'warning' : 'info'" effect="plain">{{ editable ? (tour.isOffline ? '断网暂存' : '在线调整') : '该阶段不可改字段' }}</el-tag>
            </div>
            <div class="field-editor">
              <el-form label-position="top" size="small" :disabled="!editable">
                <div class="form-grid">
                  <el-form-item label="时间码"><el-input :model-value="fieldValue('time')" @update:model-value="bind.time" /></el-form-item>
                  <el-form-item label="场景"><el-input :model-value="fieldValue('scene')" @update:model-value="bind.scene" /></el-form-item>
                  <el-form-item label="提示标题"><el-input :model-value="fieldValue('title')" @update:model-value="bind.title" /></el-form-item>
                  <el-form-item label="责任角色"><el-input :model-value="fieldValue('owner')" @update:model-value="bind.owner" /></el-form-item>
                  <el-form-item label="时长（秒）"><el-input-number :model-value="fieldValue('duration')" :min="1" @update:model-value="bind.duration" /></el-form-item>
                </div>
                <el-form-item label="灯光/音响/执行说明"><el-input type="textarea" :rows="2" :model-value="fieldValue('note')" @update:model-value="bind.note" /></el-form-item>
              </el-form>
              <div class="route-readout">
                <span v-for="(f, i) in MERGE_FIELDS.filter(x => ['entry', 'exit', 'route'].includes(x))" :key="f">
                  {{ i === 0 ? '入场' : i === 1 ? '退场' : '路线' }}：{{ fmt(fieldValue(f as MergeField)) }}
                </span>
              </div>
            </div>
          </section>

          <!-- 冲突裁决 -->
          <section v-if="batch.phase === '待裁决' && frozenCue" class="panel conflict-panel">
            <div class="panel-head"><h3>双改字段裁决 · {{ frozenCue.id }}</h3><el-tag type="danger" size="small" effect="plain">{{ conflictingFields.length }} 项</el-tag></div>
            <div v-if="!conflictingFields.length" class="muted pad">本条提示无冲突，请在上方列表选择标红的提示。</div>
            <div v-for="f in conflictingFields" :key="f" class="conflict-card">
              <div class="conflict-title">{{ fieldLabel(f) }}</div>
              <div class="conflict-versions">
                <button class="version local" @click="resolve(f, '本地暂存')">
                  <strong>本地暂存</strong><p>{{ fmt(selectedState!.fields[f]!.local) }}</p>
                </button>
                <button class="version remote" @click="resolve(f, '远端协作')">
                  <strong>远端协作</strong><p>{{ fmt(selectedState!.fields[f]!.remote) }}</p>
                </button>
              </div>
              <div class="muted base-line">冻结旧值：{{ fmt(selectedState!.fields[f]!.base) }}</div>
            </div>
          </section>
        </div>

        <!-- 右：批次提示清单 + 操作 -->
        <div class="right-col">
          <section class="panel">
            <div class="panel-head"><h3>批次提示（{{ tour.frozenCues.length }}）</h3><span class="muted">来源基线 {{ batch.fromBaselineId }}</span></div>
            <div class="cue-merge-list">
              <button
                v-for="cue in tour.frozenCues"
                :key="cue.id"
                class="cue-merge-row"
                :class="{ ...cueRowClass(batch.cueStates[cue.id]), active: cue.id === selectedCueId }"
                @click="selectedCueId = cue.id"
              >
                <span class="cm-id">{{ cue.id }}</span>
                <span class="cm-title">{{ cue.title }}</span>
                <el-tag size="small" :type="cueStatusTag(batch.cueStates[cue.id])" effect="plain">{{ batch.cueStates[cue.id]?.status }}</el-tag>
              </button>
            </div>
          </section>

          <section class="panel ops-panel">
            <div class="panel-head"><h3>批次操作</h3></div>
            <div class="ops">
              <template v-if="batch.phase === '调整中'">
                <el-button v-if="tour.isOffline" type="primary" @click="simulateRemoteThenMerge">
                  模拟远端改动并恢复联网合并
                </el-button>
                <el-button v-else type="primary" @click="mergeOnline">完成调整，合并待写入</el-button>
                <p class="muted hint">{{ tour.isOffline ? '断网修改已进入暂存；点击后会带入远端改动按字段三路合并。' : '在线修改直接记录为本地改动。' }}</p>
              </template>
              <template v-else-if="batch.phase === '待裁决'">
                <el-alert type="error" :closable="false" show-icon title="存在双改字段，未裁决前不能打印或确认" />
                <el-button disabled type="primary">请先在左侧裁决全部 {{ tour.conflictCount }} 个冲突字段</el-button>
              </template>
              <template v-else-if="batch.phase === '待写入'">
                <el-button type="primary" :loading="tour.writing" @click="write">
                  写入 {{ tour.pendingWrites.length }} 条未完成提示
                </el-button>
                <el-button plain @click="injectFailureAndContinue">注入一次写入失败（验证可恢复）</el-button>
              </template>
              <template v-else-if="batch.phase === '写入失败'">
                <el-alert type="error" :closable="false" show-icon :title="batch.error" />
                <el-button type="primary" :loading="tour.writing" @click="write">
                  继续：只补 {{ tour.pendingWrites.length }} 条未完成提示
                </el-button>
              </template>
              <template v-else-if="batch.phase === '待确认'">
                <div class="sign-box">
                  <span>出表签名</span><code>{{ tour.currentSignature }}</code>
                </div>
                <el-button type="success" @click="confirmBatch">确认并冻结新城基线</el-button>
                <el-button @click="$router.push('/print')">前往打印中心</el-button>
              </template>
              <template v-else-if="batch.phase === '已完成'">
                <el-result icon="success" title="换城完成" sub-title="新场馆演出基线已冻结，打印闸门打开">
                  <template #extra>
                    <el-button type="primary" @click="$router.push('/print')">前往打印中心</el-button>
                  </template>
                </el-result>
              </template>
            </div>
          </section>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.tour-page {
  background: #eef2f4;
}

.batch-alert {
  margin-bottom: 12px;
}

.phase-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 14px;
  padding: 14px 18px;
  overflow-x: auto;
}

.phase-node {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #8a97a3;
  font-size: 12px;
  white-space: nowrap;
}

.phase-node i {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 1px solid #cdd7dd;
  border-radius: 50%;
  font-style: normal;
  font-size: 11px;
}

.phase-node.active {
  color: #176d6c;
  font-weight: 700;
}

.phase-node.active i {
  color: #fff;
  border-color: #2f8580;
  background: #2f8580;
}

.phase-node.done i {
  color: #fff;
  border-color: #7db7b2;
  background: #7db7b2;
}

.phase-line {
  flex: 1;
  min-width: 18px;
  height: 1px;
  background: #d4dde2;
}

.phase-line.done {
  background: #7db7b2;
}

.start-panel {
  padding-bottom: 8px;
}

.start-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 24px;
  padding: 18px;
}

.start-side {
  display: grid;
  align-content: start;
  gap: 10px;
  padding-top: 6px;
}

.dims-row {
  display: flex;
  gap: 14px;
}

.archive {
  margin: 4px 12px 12px;
  border-top: 1px solid #e6ebee;
}

.baseline-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border-bottom: 1px solid #f0f3f5;
  font-size: 13px;
}

.baseline-row time {
  margin-left: auto;
  color: #93a0aa;
  font-size: 11px;
}

.tour-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.75fr);
  gap: 14px;
}

.left-col,
.right-col {
  display: grid;
  gap: 14px;
  align-content: start;
}

.venue-form {
  padding: 16px;
}

.field-editor {
  padding: 16px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}

.route-readout {
  display: grid;
  gap: 6px;
  margin-top: 8px;
}

.route-readout span {
  padding: 6px 8px;
  border: 1px dashed #d5dee3;
  border-radius: 6px;
  color: #5b6975;
  background: #f7f9fa;
  font-size: 11px;
}

.cue-merge-list {
  max-height: 380px;
  overflow: auto;
  padding: 6px;
}

.cue-merge-row {
  display: grid;
  grid-template-columns: 48px 1fr auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 8px;
  border: 0;
  border-bottom: 1px solid #eef2f4;
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.cue-merge-row.active {
  background: #eef7f6;
}

.cue-merge-row.conflict {
  background: #fdf0ef;
}

.cue-merge-row.written .cm-title {
  color: #3e9469;
}

.cue-merge-row.failed {
  background: #fbe9e7;
}

.cm-id {
  color: #1d7371;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
}

.cm-title {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ops {
  display: grid;
  gap: 10px;
  padding: 16px;
}

.hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
}

.sign-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: #60707c;
}

.sign-box code {
  padding: 4px 8px;
  border-radius: 6px;
  background: #eef3f4;
  font-size: 12px;
}

.conflict-panel .pad {
  padding: 14px;
}

.conflict-card {
  padding: 12px 14px;
  border-top: 1px solid #f0e3e2;
}

.conflict-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 700;
  color: #b0433a;
}

.conflict-versions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.conflict-versions .version {
  padding: 10px;
  border: 1px solid #e2c4c0;
  border-radius: 8px;
  text-align: left;
  background: #fff;
  cursor: pointer;
}

.conflict-versions .version:hover {
  border-color: #cf6a5f;
  box-shadow: 0 0 0 2px rgb(207 106 95 / 14%);
}

.conflict-versions .version.remote {
  border-color: #bcd0e4;
}

.conflict-versions .version.remote:hover {
  border-color: #5d8fc2;
  box-shadow: 0 0 0 2px rgb(93 143 194 / 14%);
}

.conflict-versions .version strong {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
}

.conflict-versions .version.local strong {
  color: #b0652c;
}

.conflict-versions .version.remote strong {
  color: #3a6ea3;
}

.conflict-versions .version p {
  margin: 0;
  color: #54616c;
  font-size: 11px;
  line-height: 1.55;
}

.base-line {
  margin-top: 8px;
  font-size: 11px;
}

@media (max-width: 1050px) {
  .tour-grid,
  .start-form {
    grid-template-columns: 1fr;
  }
}
</style>
