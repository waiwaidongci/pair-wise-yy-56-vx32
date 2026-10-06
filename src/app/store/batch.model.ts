import type {
  ArbitrationItem, AuditEvent, BatchOp, BatchResult, InspectionBatch, SignatureSnapshot, WeldStatus,
} from '../types'

let seq = 100
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`

export function timeLabel(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export function event(actor: string, action: string, target: string, detail: string): AuditEvent {
  return { id: nextId('AE'), time: timeLabel(Date.now()), actor, action, target, detail }
}

function snapshotHash(batch: InspectionBatch): string {
  const raw = `${batch.id}|r${batch.revision}|${batch.results.map((r) => r.opId).join(',')}`
  let h1 = 0xdeadbeef ^ raw.length, h2 = 0x41c6ce57 ^ raw.length
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const hex = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(13, '0')
  return `SHA-256:${hex}…b41a`
}

const weldStatusByKind: Record<BatchOp['kind'], WeldStatus> = {
  缺陷登记: '返修中',
  返修闭环: '待复检',
  复检判定: '合格',
}

/** 工序只能按 缺陷登记 → 返修闭环 → 复检判定 向前推进 */
const stageOf: Record<BatchOp['kind'], number> = { 缺陷登记: 1, 返修闭环: 2, 复检判定: 3 }

export interface MergeOutcome {
  batch: InspectionBatch
  events: AuditEvent[]
  merged: number
  duplicate: number
  newConflicts: number
}

/**
 * 回站合并：
 * - 按操作号幂等，重复操作不追加审计；
 * - 同一焊缝：发生时间先到的版本生效，后到内容进入待裁决区；
 * - 任一新内容提交，批次修订 +1；
 * - 锁定批次被补传 → 原签字快照立即失效，回到待复核。
 */
export function mergeOps(batch: InspectionBatch, ops: BatchOp[], checkpointsTotal: number, allAcked: number[]): MergeOutcome {
  const events: AuditEvent[] = []
  let merged = 0
  let duplicate = 0
  let newConflicts = 0
  let revision = batch.revision
  let results = batch.results
  let effective = { ...batch.effective }
  let arbitration = [...batch.arbitration]
  let welds = [...batch.welds]
  const applied = new Set(batch.appliedOpIds)

  // 同一批次内按检查点、发生时间确定“先到”
  const incoming = [...ops].sort((a, b) => a.checkpoint - b.checkpoint || a.occurredAt - b.occurredAt)

  for (const op of incoming) {
    if (applied.has(op.opId)) { duplicate += 1; continue }
    applied.add(op.opId)
    merged += 1
    revision += 1
    if (!welds.includes(op.weldId)) welds = [...welds, op.weldId]

    const incumbent = effective[op.weldId]
    let source: BatchResult['source'] = '合并生效'

    if (incumbent && incumbent.opId !== op.opId) {
      const incumbentResult = results.find((r) => r.opId === incumbent.opId)
      const incumbentTime = incumbentResult?.occurredAt ?? incumbent.occurredAt
      const incumbentStage = incumbentResult ? stageOf[incumbentResult.kind] : 0
      // 正常工序向前推进（缺陷→返修→复检）直接生效；
      // 同阶段并发判定（两名检测员同改一焊缝）或工序倒退，后到内容进入待裁决区
      const concurrentSameStage = incumbentResult ? stageOf[op.kind] === incumbentStage : false
      const regressive = stageOf[op.kind] < incumbentStage
      if (concurrentSameStage || regressive) {
        // 无论时间戳先后：生效版本先到不覆盖，并发/倒退内容一律进待裁决区
        const item: ArbitrationItem = {
          id: nextId('ARB'),
          batchId: batch.id,
          weldId: op.weldId,
          revision,
          winOpId: incumbent.opId,
          loseOpId: op.opId,
          winnerInspector: incumbent.inspector,
          loserInspector: op.inspector,
          loserOp: op,
          reason: regressive
            ? `${op.weldId}：已推进到「${incumbentResult!.kind}」，${op.inspector} 的「${op.kind}」属于工序倒退，先到版本保持生效，后到内容待裁决`
            : `两名检测员同时修改 ${op.weldId}：${incumbent.inspector} 记录于 ${timeLabel(incumbentTime)} 先到生效，${op.inspector} 后到内容待裁决`,
          arrivedAt: Date.now(),
          state: '待裁决',
        }
        arbitration = [...arbitration, item]
        newConflicts += 1
        events.push(event(op.inspector, '冲突待裁决', op.opId, item.reason))
        continue
      }
    }

    const result: BatchResult = {
      opId: op.opId, weldId: op.weldId, revision, occurredAt: op.occurredAt,
      inspector: op.inspector, kind: op.kind, summary: op.summary, source,
    }
    results = [result, ...results]
    effective = { ...effective, [op.weldId]: { opId: op.opId, inspector: op.inspector, occurredAt: op.occurredAt, revision } }
    events.push(event(op.inspector, op.kind, op.opId, `${batch.id} v${revision} · ${op.weldId}（检查点 ${op.checkpoint}）：${op.summary}`))
  }

  let snapshot = batch.snapshot
  let status = batch.status
  if (merged > 0) {
    if (snapshot?.valid && status === '已锁定') {
      snapshot = { ...snapshot, valid: false, invalidReason: '补传内容并入已签字批次' }
      status = '待复核'
      events.push(event('系统', '快照失效', batch.id, `锁定批次补传 ${merged} 条结果，v${snapshot.revision} 签字快照失效，回到待复核；其他批次不受影响`))
    } else if (status === '传输中') {
      // 检查点全部完整后，半份传输态转入待复核
      status = '待复核'
    }
  }

  return {
    merged, duplicate, newConflicts, events,
    batch: {
      ...batch,
      welds,
      revision,
      status,
      complete: true,
      checkpointsTotal,
      checkpointsAcked: allAcked,
      lastError: null,
      appliedOpIds: [...applied],
      results,
      effective,
      arbitration,
      snapshot,
      updatedAt: Date.now(),
    },
  }
}

export function signBatch(batch: InspectionBatch, signer: string): { batch: InspectionBatch; events: AuditEvent[] } {
  if (batch.status !== '待复核' && batch.status !== '传输中') {
    return { batch, events: [] }
  }
  const revision = batch.revision
  const snapshot: SignatureSnapshot = { signer, signedAt: Date.now(), revision, hash: snapshotHash(batch), valid: true }
  return {
    batch: { ...batch, status: '已锁定', snapshot, updatedAt: Date.now() },
    events: [event(signer, '签字锁定', batch.id, `修订 v${revision} 只读快照 ${snapshot.hash}，绑定计划 ${batch.planId} 与 ${batch.welds.length} 条焊缝结果`)],
  }
}

export interface ArbitrationOutcome {
  batch: InspectionBatch
  events: AuditEvent[]
}

/** 质量负责人裁决：采纳后到版本（生效版本替换），或驳回（保持先到版本） */
export function resolveArbitration(batch: InspectionBatch, itemId: string, accept: boolean, signer: string): ArbitrationOutcome {
  const item = batch.arbitration.find((a) => a.id === itemId)
  if (!item || item.state !== '待裁决') return { batch, events: [] }

  let revision = batch.revision + 1
  let results = batch.results
  let effective = batch.effective

  if (accept) {
    const op = item.loserOp
    results = [{
      opId: op.opId, weldId: op.weldId, revision, occurredAt: op.occurredAt,
      inspector: op.inspector, kind: op.kind, summary: op.summary, source: '冲突裁决采纳',
    }, ...results]
    effective = { ...effective, [op.weldId]: { opId: op.opId, inspector: op.inspector, occurredAt: op.occurredAt, revision } }
  }

  const arbitration = batch.arbitration.map((a) => a.id === itemId ? { ...a, state: accept ? '已采纳' as const : '已驳回' as const } : a)
  const detail = accept
    ? `${item.weldId}：采纳后到记录 ${item.loseOpId}（${item.loserInspector}），修订 v${revision} 生效`
    : `${item.weldId}：驳回后到记录 ${item.loseOpId}（${item.loserInspector}），维持先到版本 ${item.winOpId}`

  return {
    batch: { ...batch, revision, results, effective, arbitration, updatedAt: Date.now() },
    events: [event(signer, accept ? '裁决采纳' : '裁决驳回', itemId, `${batch.id} · ${detail}`)],
  }
}

/** 焊工资质或检测比例改动：命中该批次焊缝且快照仍有效时，快照失效、回到待复核 */
export function invalidateForRuleChange(batch: InspectionBatch, affectedWeldIds: string[], reason: string): { batch: InspectionBatch | null; events: AuditEvent[] } {
  const hit = batch.welds.some((w) => affectedWeldIds.includes(w))
  if (!hit || !(batch.snapshot?.valid) || batch.status !== '已锁定') return { batch: null, events: [] }
  return {
    batch: {
      ...batch,
      status: '待复核',
      snapshot: { ...batch.snapshot, valid: false, invalidReason: reason },
      updatedAt: Date.now(),
    },
    events: [event('系统', '快照失效', batch.id, `${reason}，命中焊缝 ${batch.welds.filter((w) => affectedWeldIds.includes(w)).join('、')}，v${batch.revision} 签字快照失效并回到待复核；其他批次不受影响`)],
  }
}

export function impliedStatus(kind: BatchOp['kind']): WeldStatus {
  return weldStatusByKind[kind]
}
