/* 纯逻辑验证：node 不参与 UI，覆盖离线补传/修订/裁决/签字/快照失效/半份提交 */
import '@angular/compiler'
import { weldReducer, initialState } from '../src/app/store/weld.reducer'
import * as A from '../src/app/store/weld.actions'
import { mergeOps, resolveArbitration, signBatch, invalidateForRuleChange } from '../src/app/store/batch.model'
import type { BatchOp, InspectionBatch } from '../src/app/types'

let pass = 0
let fail = 0
function assert(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✘ ${name} ${extra}`) }
}

const plan = { id: 'IP-T1', date: '2026-10-01', method: 'UT', weldIds: ['W-1', 'W-2'], inspector: '陈锋', state: '执行中' as const }
const now = Date.parse('2026-10-01T09:00:00+08:00')
function batch(partial: Partial<InspectionBatch> = {}): InspectionBatch {
  return {
    id: 'B-T1', planId: plan.id, plan, welds: [], revision: 0, status: '待复核',
    complete: true, checkpointsTotal: 1, checkpointsAcked: [1], lastError: null,
    appliedOpIds: [], results: [], effective: {}, arbitration: [], snapshot: null,
    createdAt: now, updatedAt: now, ...partial,
  }
}
const op = (o: Partial<BatchOp> & { opId: string; weldId: string }): BatchOp => ({
  batchId: 'B-T1', kind: '缺陷登记', inspector: '陈锋', occurredAt: now,
  baseRevision: 0, checkpoint: 1, summary: `${o.opId} 内容`, ...o,
})

console.log('1) 回站按操作号合并，每条结果带修订与发生时间')
let b = batch()
const ops4 = [
  op({ opId: 'OP-1', weldId: 'W-1', occurredAt: now + 1000 }),
  op({ opId: 'OP-2', weldId: 'W-2', occurredAt: now + 2000 }),
  op({ opId: 'OP-3', weldId: 'W-1', kind: '复检判定', inspector: '赵岚', occurredAt: now + 3000, summary: '复检合格' }),
  op({ opId: 'OP-4', weldId: 'W-2', kind: '返修闭环', occurredAt: now + 4000 }),
]
let r = mergeOps(b, ops4, 1, [1])
b = r.batch
assert('合并 4 条', r.merged === 4)
assert('修订推进到 v4', b.revision === 4, `got ${b.revision}`)
assert('每条结果带发生时间', b.results.every((x) => x.occurredAt > 0))
assert('W-1 生效为后发生的 OP-3（复检）', b.effective['W-1'].opId === 'OP-3')

console.log('2) 重复操作号：不合并、不追加审计、修订不动')
r = mergeOps(b, ops4, 1, [1])
assert('重复 4 条全部识别', r.duplicate === 4 && r.merged === 0)
assert('无审计事件', r.events.length === 0)
assert('修订仍为 v4', r.batch.revision === 4)

console.log('3) 两名检测员同改一焊缝：先到生效，后到进待裁决区')
const winner = op({ opId: 'OP-5', weldId: 'W-2', kind: '复检判定', inspector: '陈锋', occurredAt: now + 5000, summary: '陈锋：仍有显示，不合格' })
const loser = op({ opId: 'OP-6', weldId: 'W-2', kind: '复检判定', inspector: '赵岚', occurredAt: now + 5000 + 180000, summary: '赵岚：评定合格' })
r = mergeOps(b, [winner, loser], 1, [1])
b = r.batch
assert('新增 1 个待裁决', b.arbitration.filter((a) => a.state === '待裁决').length === 1)
assert('生效版本保持先到 OP-5', b.effective['W-2'].opId === 'OP-5')
assert('后到 OP-6 不在生效结果里', !b.results.some((x) => x.opId === 'OP-6'))
const arb = b.arbitration.find((a) => a.loseOpId === 'OP-6')!

console.log('4) 质量负责人裁决：采纳后到版本则生效替换且修订 +1')
r = resolveArbitration(b, arb.id, true, '周敏')
const bAccept = r.batch
assert('裁决状态=已采纳', bAccept.arbitration.find((a) => a.id === arb.id)!.state === '已采纳')
assert('生效切换为 OP-6', bAccept.effective['W-2'].opId === 'OP-6')
assert('结果标记为冲突裁决采纳', bAccept.results.find((x) => x.opId === 'OP-6')!.source === '冲突裁决采纳')
assert('修订推进到 v7', bAccept.revision === 7, `got ${bAccept.revision}`)
r = resolveArbitration(b, arb.id, false, '周敏')
assert('驳回时维持先到 OP-5', r.batch.effective['W-2'].opId === 'OP-5')

console.log('5) 签字锁定后补传：快照立即失效、回到待复核')
let signed = signBatch(b, '周敏（质量负责人）').batch
assert('签字后已锁定且快照有效', signed.status === '已锁定' && signed.snapshot!.valid)
const extra = op({ opId: 'OP-7', weldId: 'W-1', kind: '返修闭环', occurredAt: now + 9999 })
r = mergeOps(signed, [extra], 2, [1, 2])
signed = r.batch
assert('补传后回到待复核', signed.status === '待复核')
assert('签字快照失效且带原因', signed.snapshot!.valid === false && !!signed.snapshot!.invalidReason)
assert('审计写明其他批次不受影响', r.events.some((e) => e.detail.includes('其他批次不受影响')))

console.log('6) 资质/比例改动：只命中含该焊缝的锁定批次')
const other = signBatch(batch({ id: 'B-OTHER', welds: ['W-9'] }), '周敏').batch
assert('不含该焊缝的批次不受影响', invalidateForRuleChange(other, ['W-1'], '焊工资质失效').batch === null)
const lockedWithW1 = signBatch(batch({ id: 'B-LOCK', welds: ['W-1', 'W-2'] }), '周敏').batch
const hit = invalidateForRuleChange(lockedWithW1, ['W-1'], '检测比例 10%→20%')
assert('命中批次快照失效', hit.batch?.snapshot?.valid === false && hit.batch?.status === '待复核')

console.log('7) 补传失败：半份批次不能提交，最后完整检查点之后续传')
let state = weldReducer(initialState, { type: 'noop' } as never)
const cpOps = [
  op({ opId: 'CP-1', weldId: 'W-104', batchId: 'B-NEW', checkpoint: 1 }),
  op({ opId: 'CP-2', weldId: 'W-107', batchId: 'B-NEW', checkpoint: 2 }),
].map((o) => ({ ...o, batchId: 'B-NEW' }))
state = { ...state, offlineOps: cpOps, plans: [{ ...plan, id: 'IP-NEW', weldIds: ['W-104', 'W-107'] }] }
state = weldReducer(state, A.beginUpload({ batchId: 'B-NEW', checkpointsTotal: 2 }))
state = weldReducer(state, A.ackCheckpoint({ batchId: 'B-NEW', checkpoint: 1 }))
const halfState = weldReducer(state, A.commitUpload({ batchId: 'B-NEW', ops: cpOps, checkpointsTotal: 2 }))
assert('仅 1/2 检查点：提交被拒绝', halfState === state)
assert('半份批次标记 complete=false', halfState.batches.find((x) => x.id === 'B-NEW')!.complete === false)
state = weldReducer(state, A.ackCheckpoint({ batchId: 'B-NEW', checkpoint: 2 }))
state = weldReducer(state, A.commitUpload({ batchId: 'B-NEW', ops: cpOps, checkpointsTotal: 2 }))
const done = state.batches.find((x) => x.id === 'B-NEW')!
assert('全部检查点完整才合并', done.complete && done.results.length === 2 && done.status !== '传输中')
assert('断点续传不重发：applied 无重复', new Set(done.appliedOpIds).size === done.appliedOpIds.length)

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail) process.exit(1)
