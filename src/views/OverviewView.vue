<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { useWorkshopStore } from '../stores/workshop'

const store = useWorkshopStore()
const { data: project } = useQuery({
  queryKey: ['project'],
  queryFn: async () => (await axios.get('/api/project')).data,
  enabled: import.meta.env.DEV,
  initialData: {
    name: '潮汐来信',
    venue: '上海大剧院 · 大剧场',
    rehearsalDate: '2026-10-08',
    company: '远岸剧团',
  },
})

const finalizeOpen = ref(false)
const newVenueName = ref('')
const newVenueWidth = ref(12)
const newVenueDepth = ref(10)

const pending = computed(() => store.cues.filter((cue) => cue.status !== '已确认').length)
const comments = computed(() => store.cues.reduce((total, cue) => total + cue.comments.filter((item) => !item.resolved).length, 0))
const totalMinutes = computed(() => Math.round(store.cues.reduce((sum, cue) => sum + cue.duration, 0) / 60))
const byDepartment = computed(() =>
  ['舞台', '灯光', '音响', '道具'].map((department) => ({
    department,
    count: store.cues.filter((cue) => cue.department === department).length,
  })),
)
const nextCues = computed(() => [...store.cues].sort((a, b) => a.time.localeCompare(b.time)).slice(0, 4))

function openFinalize() {
  newVenueName.value = ''
  newVenueWidth.value = store.currentVenue.width
  newVenueDepth.value = store.currentVenue.depth
  finalizeOpen.value = true
}

function confirmFinalize() {
  if (!newVenueName.value.trim()) {
    ElMessage.warning('请填写新场馆名称')
    return
  }
  store.finalizeCity({ name: newVenueName.value.trim(), width: newVenueWidth.value, depth: newVenueDepth.value })
  finalizeOpen.value = false
  ElMessage.success('新场馆已定稿，上一城演出基线已冻结')
}

async function sync() {
  if (store.isOffline) {
    ElMessage.warning('离线状态下修改已暂存，恢复联网后自动合并')
    return
  }
  await store.syncBatch()
  if (store.writeFailed) {
    ElMessage.error('写入失败，未完成批次已保留，可继续同步')
  } else if (store.hasPendingConflicts) {
    ElMessage.warning('已按字段合并，存在未裁决冲突，裁决前禁止打印')
  } else {
    ElMessage.success('批次已同步')
  }
}

async function resume() {
  await store.resumeBatch()
  if (store.writeFailed) {
    ElMessage.error('仍有未完成提示，批次已保留')
  } else {
    ElMessage.success('未完成提示已补齐')
  }
}

function resolve(cueId: string, field: string, chosen: 'local' | 'remote') {
  store.resolveConflict(cueId, field, chosen)
  ElMessage.success('已裁决，采用' + (chosen === 'local' ? '本地' : '远端') + '版本')
}

function fieldLabel(field: string) {
  const map: Record<string, string> = {
    act: '幕次',
    scene: '场景',
    time: '时间码',
    title: '标题',
    department: '部门',
    owner: '责任',
    duration: '时长',
    note: '执行说明',
    status: '状态',
    route: '路线',
    entry: '入场点',
    exit: '退场点',
  }
  return map[field] ?? field
}

function formatValue(value: unknown) {
  if (value == null) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <p class="eyebrow">TOUR CONTROL / 巡演控制</p>
        <h1>{{ project.name }} · 巡演总览</h1>
        <p class="muted">{{ project.venue }} · 排练日 {{ project.rehearsalDate }} · {{ project.company }}</p>
      </div>
      <div class="actions">
        <el-button @click="store.toggleOffline">{{ store.isOffline ? '恢复在线' : '模拟离线' }}</el-button>
        <el-button type="primary" @click="$router.push('/stage')">进入舞台工作区</el-button>
      </div>
    </div>

    <div class="metric-grid">
      <article class="metric">
        <span>脚本节点</span>
        <strong>{{ store.cues.length }}</strong>
        <small>覆盖三幕 {{ new Set(store.cues.map((cue) => cue.scene)).size }} 个场景</small>
      </article>
      <article class="metric">
        <span>待确认事项</span>
        <strong class="amber">{{ pending }}</strong>
        <small>确认后进入演出基线</small>
      </article>
      <article class="metric">
        <span>未解决留言</span>
        <strong class="red">{{ comments }}</strong>
        <small>跨部门协同处理中</small>
      </article>
      <article class="metric">
        <span>计划时长</span>
        <strong>{{ totalMinutes }}<small> 分</small></strong>
        <small>当前版本 {{ store.revision }}</small>
      </article>
    </div>

    <section class="panel batch-panel">
      <div class="panel-head">
        <h3>换城批次</h3>
        <span class="muted">可恢复 · 离线暂存 · 联网按字段合并</span>
      </div>

      <div class="batch-grid">
        <div class="batch-status">
          <div class="batch-no">批次 <strong>{{ store.batchNo }}</strong></div>
          <div class="batch-venue">
            <span class="muted">{{ store.currentVenue.name }}</span>
            <strong>{{ store.currentVenue.width }} × {{ store.currentVenue.depth }} m</strong>
          </div>
          <div class="batch-tags">
            <el-tag size="small" :type="store.isOffline ? 'warning' : 'success'" effect="plain">
              {{ store.isOffline ? '离线暂存中' : '在线' }}
            </el-tag>
            <el-tag v-if="store.stagedCount" size="small" type="info" effect="plain">
              {{ store.stagedCount }} 项暂存修改
            </el-tag>
            <el-tag v-if="store.writeFailed" size="small" type="danger" effect="plain">写入失败</el-tag>
            <el-tag v-if="store.writeFailed" size="small" type="warning" effect="plain">未完成批次已保留</el-tag>
          </div>
        </div>

        <div class="batch-actions">
          <el-button type="primary" @click="openFinalize">新场馆定稿</el-button>
          <el-button :loading="store.isWriting" @click="sync">联网合并</el-button>
          <el-button v-if="store.writeFailed" type="warning" @click="resume">继续同步</el-button>
          <el-button :disabled="!store.confirmationsInvalid" @click="store.confirmAll">全部确认</el-button>
          <el-button :disabled="!store.tablesInvalid" @click="store.generateTables">重新出表</el-button>
        </div>
      </div>

      <el-alert
        v-if="store.writeFailed"
        class="batch-alert"
        type="error"
        show-icon
        :closable="false"
        title="上一次写入失败，未完成批次已保留"
        :description="store.writeError ?? '网络异常'"
      />

      <el-alert
        v-if="store.confirmationsInvalid"
        class="batch-alert"
        type="warning"
        show-icon
        :closable="false"
        title="确认已失效"
        description="场馆尺寸或提示字段已变更，需重新确认后再出表。"
      />

      <el-alert
        v-if="store.tablesInvalid"
        class="batch-alert"
        type="warning"
        show-icon
        :closable="false"
        title="出表已失效"
        description="场馆尺寸或提示字段已变更，需重新生成出表。"
      />

      <div v-if="store.pendingConflicts.length" class="conflict-list">
        <div class="conflict-head">未裁决字段冲突（{{ store.pendingConflicts.length }}）· 裁决前禁止打印</div>
        <div v-for="conflict in store.pendingConflicts" :key="conflict.id" class="conflict-row">
          <div class="conflict-meta">
            <strong>{{ conflict.cueId }}</strong>
            <span>{{ fieldLabel(conflict.field) }}</span>
          </div>
          <div class="conflict-versions">
            <button class="version local" @click="resolve(conflict.cueId, conflict.field, 'local')">
              <em>本地</em>
              <code>{{ formatValue(conflict.local.value) }}</code>
            </button>
            <button class="version remote" @click="resolve(conflict.cueId, conflict.field, 'remote')">
              <em>远端</em>
              <code>{{ formatValue(conflict.remote.value) }}</code>
            </button>
          </div>
        </div>
      </div>

      <div v-if="store.baselines.length" class="baseline-archive">
        <div class="conflict-head">历史基线（{{ store.baselines.length }}）· 原路线与留言继续可查</div>
        <div class="baseline-list">
          <button v-for="baseline in store.baselines" :key="baseline.id" class="baseline-chip" @click="store.viewBaseline(baseline)">
            第 {{ baseline.batchNo }} 城 · {{ baseline.venue.name }}
            <small>{{ baseline.revision }} · {{ baseline.cues.length }} 节点</small>
          </button>
        </div>
      </div>
    </section>

    <div class="overview-grid">
      <section class="panel">
        <div class="panel-head">
          <h3>下一组执行节点</h3>
          <span class="online">{{ store.isOffline ? '离线草稿' : '多人编辑中' }}</span>
        </div>
        <div class="cue-list">
          <button v-for="cue in nextCues" :key="cue.id" class="cue-row" @click="store.selectedId = cue.id; $router.push('/stage')">
            <time>{{ cue.time }}</time>
            <span>
              <strong>{{ cue.title }}</strong>
              <small>{{ cue.act }} / {{ cue.scene }} · {{ cue.owner }}</small>
            </span>
            <el-tag :type="cue.status === '已确认' ? 'success' : cue.status === '待确认' ? 'warning' : 'info'" effect="plain">
              {{ cue.status }}
            </el-tag>
          </button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h3>部门负荷</h3>
          <span class="muted">按提示数</span>
        </div>
        <div class="dept-list">
          <div v-for="item in byDepartment" :key="item.department" class="dept-row">
            <span>{{ item.department }}</span>
            <div class="bar-track"><i :style="{ width: `${(item.count / store.cues.length) * 100}%` }" /></div>
            <strong>{{ item.count }}</strong>
          </div>
        </div>
        <div class="conflict-card" :class="{ ok: store.conflicts.length === 0 }">
          <strong>{{ store.conflicts.length ? `发现 ${store.conflicts.length} 项潜在冲突` : '未发现时间冲突' }}</strong>
          <p>{{ store.conflicts.length ? '同一场景存在同时触发的提示，请在舞台工作区核对优先级。' : '当前提示的时间与场景编排一致。' }}</p>
          <el-button v-if="store.conflicts.length" text type="warning" @click="$router.push('/stage')">定位冲突</el-button>
        </div>
      </section>
    </div>

    <el-dialog v-model="finalizeOpen" title="新场馆定稿" width="420px">
      <el-form label-position="top">
        <el-form-item label="场馆名称">
          <el-input v-model="newVenueName" placeholder="例如：广州大剧院 · 歌剧厅" />
        </el-form-item>
        <el-form-item label="台口宽 (m)">
          <el-input-number v-model="newVenueWidth" :min="1" :max="30" :step="0.5" style="width: 100%" />
        </el-form-item>
        <el-form-item label="台深 (m)">
          <el-input-number v-model="newVenueDepth" :min="1" :max="30" :step="0.5" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="finalizeOpen = false">取消</el-button>
        <el-button type="primary" @click="confirmFinalize">定稿并冻结旧提示</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="store.viewingBaseline" title="历史基线" width="720px">
      <div v-if="store.viewingBaseline" class="baseline-view">
        <div class="baseline-view-head">
          <strong>第 {{ store.viewingBaseline.batchNo }} 城 · {{ store.viewingBaseline.venue.name }}</strong>
          <span class="muted">{{ store.viewingBaseline.revision }} · 冻结于 {{ store.viewingBaseline.frozenAt }}</span>
        </div>
        <div v-for="cue in store.viewingBaseline.cues" :key="cue.id" class="baseline-cue">
          <div class="baseline-cue-head">
            <strong>{{ cue.id }} · {{ cue.title }}</strong>
            <el-tag size="small" effect="plain">{{ cue.status }}</el-tag>
          </div>
          <p>{{ cue.note || '暂无说明' }}</p>
          <small>路线：{{ cue.route.map((point) => `${point.x},${point.y}`).join(' → ') }}</small>
          <small v-if="cue.comments.length">留言：{{ cue.comments.length }} 条</small>
        </div>
      </div>
    </el-dialog>
  </section>
</template>

<style scoped>
.amber {
  color: #b77014 !important;
}

.red {
  color: #bd4b3f !important;
}

.batch-panel {
  margin-bottom: 14px;
  padding: 16px;
}

.batch-grid {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.batch-status {
  display: flex;
  align-items: center;
  gap: 18px;
}

.batch-no strong {
  color: #176d6c;
  font-size: 22px;
}

.batch-venue {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.batch-venue strong {
  color: #102938;
  font-size: 15px;
}

.batch-tags {
  display: flex;
  gap: 6px;
}

.batch-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.batch-alert {
  margin-bottom: 10px;
}

.conflict-list {
  margin-top: 10px;
  padding: 12px;
  border: 1px solid #f0d9b5;
  border-radius: 8px;
  background: #fffaf0;
}

.conflict-head {
  margin-bottom: 10px;
  color: #8a5a17;
  font-size: 13px;
  font-weight: 700;
}

.conflict-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px dashed #ecd9b0;
}

.conflict-row:last-child {
  border-bottom: 0;
}

.conflict-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 90px;
}

.conflict-meta strong {
  color: #176d6c;
}

.conflict-meta span {
  color: #7a8692;
  font-size: 12px;
}

.conflict-versions {
  display: flex;
  gap: 8px;
}

.version {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 7px 10px;
  border: 1px solid #dce3e7;
  border-radius: 6px;
  text-align: left;
  background: #fff;
  cursor: pointer;
}

.version:hover {
  border-color: #2f8580;
}

.version em {
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
}

.version.local em {
  color: #2f7d5b;
}

.version.remote em {
  color: #b05a2b;
}

.version code {
  color: #33424d;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}

.baseline-archive {
  margin-top: 12px;
}

.baseline-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.baseline-chip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 11px;
  border: 1px solid #dce3e7;
  border-radius: 6px;
  background: #f6f9f9;
  cursor: pointer;
}

.baseline-chip:hover {
  border-color: #2f8580;
}

.baseline-chip small {
  color: #7a8692;
  font-size: 11px;
}

.baseline-view-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 12px;
}

.baseline-cue {
  padding: 10px 0;
  border-bottom: 1px solid #eef1f2;
}

.baseline-cue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.baseline-cue p {
  margin: 6px 0;
  color: #56636d;
  font-size: 13px;
}

.baseline-cue small {
  display: block;
  color: #7e8991;
  font-size: 12px;
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.65fr);
  gap: 14px;
}

.cue-list {
  padding: 6px;
}

.cue-row {
  display: grid;
  width: 100%;
  grid-template-columns: 76px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 13px 10px;
  border: 0;
  border-bottom: 1px solid #edf0f2;
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.cue-row:hover {
  background: #f5f8f8;
}

.cue-row time {
  color: #247c7c;
  font-family: ui-monospace, monospace;
  font-weight: 700;
}

.cue-row strong,
.cue-row small {
  display: block;
}

.cue-row small {
  margin-top: 4px;
  color: #7a8692;
}

.dept-list {
  display: grid;
  gap: 18px;
  padding: 20px;
}

.dept-row {
  display: grid;
  grid-template-columns: 48px 1fr 24px;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.bar-track {
  height: 8px;
  overflow: hidden;
  border-radius: 8px;
  background: #e7ecee;
}

.bar-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #2f8580;
}

.conflict-card {
  margin: 0 16px 16px;
  padding: 14px;
  border-left: 3px solid #d8912d;
  background: #fff8e8;
}

.conflict-card.ok {
  border-left-color: #4b9d72;
  background: #f0f8f3;
}

.conflict-card p {
  margin: 6px 0 0;
  color: #687582;
  font-size: 12px;
  line-height: 1.55;
}

.online {
  color: #2e8064;
  font-size: 12px;
}

@media (max-width: 1050px) {
  .overview-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 600px) {
  .cue-row {
    grid-template-columns: 64px 1fr;
  }

  .cue-row .el-tag {
    grid-column: 2;
    justify-self: start;
  }

  .batch-grid {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
