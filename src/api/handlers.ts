import { http, HttpResponse } from 'msw'
import { seedCues, seedMovers, seedProject, type Cue } from '../stores/workshop'

let cues = structuredClone(seedCues)

type RemoteBatch = {
  cues: Cue[]
  baseline: { batchNo: number; venue: { name: string; width: number; depth: number }; frozenAt: string }
  toVenue: { name: string; width: number; depth: number }
}

const remoteBatches = new Map<number, RemoteBatch>()

function applyRemoteEdits(cues: Cue[]) {
  const c4 = cues.find((cue) => cue.id === 'C-04')
  if (c4) c4.time = '00:23:40'
  const c2 = cues.find((cue) => cue.id === 'C-02')
  if (c2) c2.note = '使用 B 版信封，背台侧完成交接；远端补注：提前 3 分钟预热道具。'
  const c1 = cues.find((cue) => cue.id === 'C-01')
  if (c1) {
    c1.comments.push({
      id: `remote-${Date.now()}`,
      author: '远端协作 · 王灯控',
      content: '远端已更新面光时序，请合并后核对。',
      createdAt: new Date().toISOString(),
      resolved: false,
    })
  }
}

export const handlers = [
  http.get('/api/project', () => HttpResponse.json(seedProject)),
  http.get('/api/cues', () =>
    HttpResponse.json(
      cues.map((cue) => ({
        ...cue,
        conflict: cue.id === 'C-06' ? '此提示与道具运输时间重叠 4 分钟' : '',
      })),
    ),
  ),
  http.post('/api/cues/:id/comments', async ({ params, request }) => {
    const body = (await request.json()) as { author: string; content: string }
    const cue = cues.find((item) => item.id === params.id)
    if (!cue) return new HttpResponse(null, { status: 404 })
    cue.comments.push({
      id: `comment-${Date.now()}`,
      author: body.author,
      content: body.content,
      createdAt: new Date().toISOString(),
      resolved: false,
    })
    return HttpResponse.json(cue, { status: 201 })
  }),
  http.post('/api/sync', async ({ request }) => {
    const body = (await request.json()) as { cues: typeof cues }
    cues = structuredClone(body.cues)
    return HttpResponse.json({ syncedAt: new Date().toISOString(), revision: Date.now() })
  }),
  http.post('/api/city-batch/finalize', async ({ request }) => {
    const body = (await request.json()) as {
      batchNo: number
      fromVenue: { name: string; width: number; depth: number }
      toVenue: { name: string; width: number; depth: number }
      cues: Cue[]
    }
    const remoteCues = structuredClone(body.cues)
    applyRemoteEdits(remoteCues)
    remoteBatches.set(body.batchNo, {
      cues: remoteCues,
      baseline: { batchNo: body.batchNo, venue: body.fromVenue, frozenAt: new Date().toISOString() },
      toVenue: body.toVenue,
    })
    return HttpResponse.json({ ok: true, batchNo: body.batchNo, remoteCues })
  }),
  http.get('/api/city-batch/remote', ({ request }) => {
    const url = new URL(request.url)
    const batchNo = Number(url.searchParams.get('batchNo') ?? '0')
    const batch = remoteBatches.get(batchNo)
    if (!batch) return new HttpResponse(null, { status: 404 })
    return HttpResponse.json(structuredClone(batch.cues))
  }),
  http.post('/api/city-batch/sync', async ({ request }) => {
    const body = (await request.json()) as { batchNo: number; cues: Cue[] }
    const batch = remoteBatches.get(body.batchNo)
    if (!batch) return new HttpResponse(null, { status: 404 })
    batch.cues = structuredClone(body.cues)
    return HttpResponse.json({ ok: true, syncedAt: new Date().toISOString() })
  }),
]

export { seedMovers }
