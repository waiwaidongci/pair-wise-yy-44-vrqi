// 换城批次核心需求的端到端验证（node 运行，不依赖浏览器）
import { createPinia, setActivePinia } from 'pinia'
import { useWorkshopStore } from '../src/stores/workshop'
import { useTourStore } from '../src/stores/tour'
import { canPrint, computeSignature, fieldEqual } from '../src/tour/fields'

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass += 1
    console.log(`  ✓ ${msg}`)
  } else {
    fail += 1
    console.error(`  ✗ ${msg}`)
  }
}

function freshStores() {
  localStorage.clear()
  setActivePinia(createPinia())
  const workshop = useWorkshopStore()
  const tour = useTourStore()
  return { workshop, tour }
}

async function main() {
  console.log('\n[1] 旧稿缺批次号 → 升级为首版，原路线与留言保留')
  {
    const { tour, workshop } = freshStores()
    assert(tour.baselines.length === 1, '自动生成一条基线')
    const bl = tour.baselines[0]
    assert(bl.label === '首版（旧稿升级）' && bl.batchId === 'B-000', '标记为「首版（旧稿升级）」，批次号 B-000')
    const c1 = bl.cues.find((c) => c.id === 'C-01')!
    assert(c1.route.length === 3 && c1.comments.length === 1, '原路线节点与部门留言完整保留')
    assert(workshop.cues.length === bl.cues.length, '工作区提示与首版基线一致')
  }

  console.log('\n[2] 新场馆定稿才冻结旧提示；锁定只改状态不改文字')
  {
    const { tour, workshop } = freshStores()
    const before = JSON.stringify(tour.latestBaseline!.cues)
    tour.startBatch({ venueName: '杭州大剧院 · 歌剧院', widthM: 18, depthM: 14 })
    assert(tour.activeBatch!.phase === '待定稿', '批次创建后处于待定稿，尚未冻结')
    assert(tour.baselines.length === 1 && !workshop.locked, '定稿前不新增基线、不锁定工作区')
    tour.finalizeVenue()
    assert(tour.activeBatch!.phase === '调整中', '定稿后进入调整中')
    assert(tour.baselines.length === 1, '定稿复用已有不可变基线，不重复产生冻结基线')
    assert(tour.activeBatch!.fromBaselineId === tour.baselines[0].id, '批次引用被冻结的上一城基线')
    assert(JSON.stringify(tour.baselines[0].cues) === before, '冻结基线内容与上一城逐字一致（只改状态）')
    assert(workshop.locked && workshop.tourFrozen, '工作区进入冻结只读')
    workshop.unlockBaseline()
    assert(workshop.locked, '冻结期间无法从其他页面解锁旧提示')
  }

  console.log('\n[3] 断网修改先暂存；联网后按字段三路合并，双改保留两版来源')
  {
    const { tour } = freshStores()
    tour.startBatch({ venueName: '杭州大剧院 · 歌剧院', widthM: 18, depthM: 14 })
    tour.finalizeVenue()
    tour.toggleOffline()
    assert(tour.isOffline && tour.networkNote.includes('暂存'), '模拟离线只换状态文字')
    // 本地断网改 C-01 的说明
    tour.editField('C-01', 'note', '本地暂存：入场改为台口左二门')
    assert(tour.activeBatch!.staged.length === 1, '断网改动进入暂存队列')
    // 另一终端在服务器上改了同一字段（冲突）与另一提示的时间（单边）
    tour.simulateRemoteEdits()
    assert(tour.remoteQueue[tour.activeBatch!.id].length === 2, '远端改动在断网期间排队')
    tour.reconnectAndMerge()
    assert(!tour.isOffline, '恢复联网只切状态')
    const b = tour.activeBatch!
    assert(b.phase === '待裁决', '存在双改字段 → 批次进入待裁决')
    const c1 = b.cueStates['C-01']
    const note = c1.fields.note!
    assert(note.status === '冲突待裁决', 'C-01 说明两边都改 → 冲突待裁决')
    assert(note.sources.length === 2 && note.local !== undefined && note.remote !== undefined, '两版来源（本地/远端）都保留')
    const c4 = b.cueStates['C-04'].fields.time!
    assert(c4.status === '已合并' && fieldEqual(c4.resolved, '00:23:08'), '只有远端改的字段自动采纳远端')
    const gate = canPrint(b, tour.frozenCues)
    assert(!gate.ok && gate.reason.includes('裁决'), '没有裁决前不能打印')
  }

  console.log('\n[4] 裁决后写入；失败保留批次，继续只补未完成提示；重复继续不多出基线')
  {
    const { tour } = freshStores()
    tour.startBatch({ venueName: '杭州大剧院 · 歌剧院', widthM: 18, depthM: 14 })
    tour.finalizeVenue()
    tour.toggleOffline()
    tour.editField('C-01', 'note', '本地暂存：入场改为台口左二门')
    tour.simulateRemoteEdits()
    tour.reconnectAndMerge()
    tour.resolveConflict('C-01', 'note', '本地暂存')
    assert(tour.activeBatch!.phase === '待写入', '全部冲突裁决后进入待写入')
    assert(tour.pendingWrites.length === 2, '待写入提示 = 本地改的 C-01 + 远端改的 C-04')

    tour.armFailure(1) // 下一次写入失败
    await tour.writePending()
    assert(tour.activeBatch!.phase === '写入失败', '写入失败后批次保留为「写入失败」')
    assert(tour.activeBatch!.cueStates['C-01'].status === '写入失败', 'C-01 标记写入失败')
    assert(tour.baselines.length === 1, '失败不产生新基线')

    await tour.writePending() // 继续
    const b2 = tour.activeBatch!
    assert(b2.phase === '待确认', '继续后全部完成 → 待确认')
    assert(b2.cueStates['C-01'].written && b2.cueStates['C-04'].written, '两条提示均已写入')
    assert(tour.pendingWrites.length === 0, '无未完成提示')

    await tour.writePending() // 再点继续
    assert(tour.baselines.length === 1, '重复继续不会多出基线/重复写入')
  }

  console.log('\n[5] 确认冻结新城基线；场馆尺寸或任一字段变化使确认/出表失效重算')
  {
    const { tour } = freshStores()
    tour.startBatch({ venueName: '杭州大剧院 · 歌剧院', widthM: 18, depthM: 14 })
    tour.finalizeVenue()
    tour.editField('C-02', 'time', '00:06:12')
    tour.prepareWritesOnline()
    await tour.writePending()
    const sig1 = tour.currentSignature
    assert(tour.activeBatch!.phase === '待确认' && sig1.length === 8, '写入完成并算出表签名')
    tour.confirmBatch()
    assert(tour.activeBatch!.phase === '已完成', '确认后批次完成')
    assert(tour.baselines.length === 2 && tour.baselines[1].label.includes('杭州'), '确认时才冻结新城演出基线，旧基线仍在档')
    assert(tour.printGate.ok, '裁决完成且确认无变化 → 打印闸门开启')
    const mergedC1 = tour.mergedCues.find((c) => c.id === 'C-02')!
    assert(mergedC1.time === '00:06:12', '出表内容使用合并后字段')

    // 直接用闸门逻辑验证：确认后改场馆宽 → 签名变化 → 确认失效
    const finished = tour.activeBatch!
    const changedVenue = { ...finished, venue: { ...finished.venue, widthM: 20 } }
    const gateVenue = canPrint({ ...changedVenue, confirmed: true, confirmedSignature: sig1 }, tour.frozenCues)
    assert(!gateVenue.ok && gateVenue.reason.includes('失效'), '场馆宽度变化后确认与出表失效')

    // 改任一字段 → 签名同样变化（JSON 深拷贝避免克隆响应式代理）
    const cs = JSON.parse(JSON.stringify(finished.cueStates['C-02'])) as typeof finished.cueStates['C-02']
    cs.fields.time = { ...cs.fields.time!, resolved: '00:06:30' }
    const changedField = { ...finished, cueStates: { ...finished.cueStates, ['C-02']: cs } }
    const sigField = computeSignature(changedField, tour.frozenCues)
    assert(sigField !== sig1, '任一字段变化都会重算出表签名')
    assert(!canPrint({ ...changedField, confirmed: true, confirmedSignature: sig1 }, tour.frozenCues).ok, '字段变化后不能打印')
  }

  console.log('\n[6] 按新场馆宽深调整走位（逐字段暂存，冻结基线不动）')
  {
    const { tour } = freshStores()
    tour.startBatch({ venueName: '杭州大剧院 · 歌剧院', widthM: 18, depthM: 14 })
    tour.finalizeVenue()
    const frozenEntry = tour.frozenCues.find((c) => c.id === 'C-01')!.entry
    tour.rescaleCue('C-01')
    const localEntry = tour.activeBatch!.cueStates['C-01'].fields.entry!.local as { x: number; y: number }
    const sx = 18 / 16
    const sy = 14 / 12
    const round1 = (n: number) => Math.round(n * 10) / 10
    assert(localEntry.x === round1(frozenEntry.x * sx) && localEntry.y === round1(frozenEntry.y * sy), '入场点按宽深比缩放（精确到 0.1 米）')
    const blEntry = tour.baselines[0].cues.find((c) => c.id === 'C-01')!.entry
    assert(fieldEqual(blEntry, frozenEntry), '冻结基线的走位坐标未被修改')
  }

  console.log('\n[7] 仅改场馆尺寸、无字段改动：不写任何提示也能确认出表')
  {
    const { tour } = freshStores()
    tour.startBatch({ venueName: '南京保利大剧院', widthM: 15, depthM: 11 })
    tour.finalizeVenue()
    tour.prepareWritesOnline()
    assert(tour.activeBatch!.phase === '待确认', '无字段改动时跳过写入直接待确认')
    assert(tour.pendingWrites.length === 0, '无待写入提示')
    tour.confirmBatch()
    assert(tour.activeBatch!.phase === '已完成' && tour.printGate.ok, '确认后完成且可打印')
    assert(tour.baselines[1].venueName === '南京保利大剧院', '新基线带新城馆尺寸')
  }

  console.log('\n[8] 刷新（重新挂载 store）后：未完成批次与冻结锁恢复')
  {
    freshStores()
    let tour = useTourStore()
    let workshop = useWorkshopStore()
    tour.startBatch({ venueName: '杭州大剧院 · 歌剧院', widthM: 18, depthM: 14 })
    tour.finalizeVenue()
    tour.toggleOffline()
    tour.editField('C-02', 'time', '00:06:20')
    // 模拟刷新：同一 localStorage 下重新建 pinia 与 store
    setActivePinia(createPinia())
    workshop = useWorkshopStore()
    tour = useTourStore()
    const b = tour.activeBatch!
    assert(b.id === 'B-001' && b.phase === '调整中', '未完成批次持久化并恢复为活动批次')
    assert(workshop.locked && workshop.tourFrozen, '冻结只读锁在刷新后恢复')
    assert(b.staged.length === 1 && b.staged[0].field === 'time', '断网暂存改动仍在，联网后可继续合并')
    assert(tour.isOffline === false, '离线是会话状态：刷新后安全默认在线（暂存不丢，仍需手动合并）')
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败\n`)
  if (fail > 0) process.exit(1)
}

main()
