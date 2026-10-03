import { http, HttpResponse } from 'msw'
import { seedCues, seedMovers, seedProject } from '../stores/workshop'
import type { WritePayload, WriteResult } from './tour'

let cues = structuredClone(seedCues)

/** 服务端已成功写入的 (批次, 提示) 集合：重复继续时幂等，不会重复产生基线 */
const committedWrites = new Set<string>()

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

  // 换城批次：逐提示写入，服务端按 (批次号, 提示号) 幂等，支持故障注入
  http.post('/api/tour/commit', async ({ request }) => {
    const payload = (await request.json()) as WritePayload
    const key = `${payload.batchId}:${payload.cueId}`
    await new Promise((resolve) => setTimeout(resolve, 220))
    if (payload.forceFail) {
      return HttpResponse.json({ message: '写入失败：场馆服务暂不可用，批次已保留' }, { status: 503 })
    }
    const duplicate = committedWrites.has(key)
    committedWrites.add(key)
    const result: WriteResult = {
      batchId: payload.batchId,
      cueId: payload.cueId,
      writtenAt: new Date().toISOString(),
      duplicate,
    }
    return HttpResponse.json(result, { status: 201 })
  }),
]

export { seedMovers }
