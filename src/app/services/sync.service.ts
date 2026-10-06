import { inject, Injectable } from '@angular/core'
import { Store } from '@ngrx/store'
import { MessageService } from 'primeng/api'
import { firstValueFrom } from 'rxjs'
import type { BatchOp } from '../types'
import { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly store = inject(Store<{ welds: WeldState }>)
  private readonly message = inject(MessageService)
  private running = new Set<string>()

  /**
   * 回站补传：
   * - 检查点逐个确认，最后一个完整检查点之前不重复发送；
   * - 在 failAfterCheckpoint 处模拟断网：半份批次保持“传输中”，不进入总览；
   * - 全部检查点完整后整批原子合并（操作号幂等、同焊缝先到生效）。
   */
  async upload(batchId: string, failAfterCheckpoint = 0): Promise<boolean> {
    if (this.running.has(batchId)) return false
    this.running.add(batchId)
    try {
      const snap = await firstValueFrom(this.store.select((s: { welds: WeldState }) => s.welds))
      const ops = snap.offlineOps.filter((o) => o.batchId === batchId)
      if (!ops.length) {
        this.message.add({ severity: 'warn', summary: '没有待补传操作', detail: `${batchId} 离线队列为空` })
        return false
      }
      const checkpointsTotal = Math.max(...ops.map((o) => o.checkpoint))
      const batch = snap.batches.find((b) => b.id === batchId)
      const startAcked = batch?.complete ? checkpointsTotal : (batch?.checkpointsAcked.length ?? 0)

      if (startAcked >= checkpointsTotal) {
        this.message.add({ severity: 'info', summary: '检查点均已完整', detail: '直接提交整批合并，不重复发送操作' })
      } else {
        this.store.dispatch(A.beginUpload({ batchId, checkpointsTotal }))
        await delay(120)
        if (startAcked > 0) {
          this.message.add({ severity: 'info', summary: `从检查点 ${startAcked + 1} 断点续传`, detail: `前 ${startAcked} 个完整检查点不重发` })
        }
        for (let cp = startAcked + 1; cp <= checkpointsTotal; cp++) {
          await delay(420)
          if (cp === failAfterCheckpoint) {
            this.store.dispatch(A.uploadFailed({ batchId, checkpoint: cp, error: '信号丢失 / 网关超时' }))
            this.message.add({
              severity: 'error', summary: `补传中断于检查点 ${cp}`,
              detail: `前 ${cp - 1} 个检查点已保留，重试从检查点 ${cp} 开始；半份批次不进入总览`,
            })
            return false
          }
          this.store.dispatch(A.ackCheckpoint({ batchId, checkpoint: cp }))
        }
      }

      const done = await firstValueFrom(this.store.select((s: { welds: WeldState }) => s.welds))
      const current = done.batches.find((b) => b.id === batchId)
      const acked = current?.checkpointsAcked ?? Array.from({ length: checkpointsTotal }, (_, i) => i + 1)
      const all = Array.from({ length: checkpointsTotal }, (_, i) => i + 1)
      if (!all.every((c: number) => acked.includes(c))) {
        this.message.add({ severity: 'error', summary: '检查点不完整', detail: '缺少完整检查点，拒绝提交半份批次' })
        return false
      }

      const before = current?.appliedOpIds ?? []
      const pendingBefore = new Set(
        (current?.arbitration ?? []).filter((a) => a.state === '待裁决').map((a) => a.id),
      )
      this.store.dispatch(A.commitUpload({ batchId, ops, checkpointsTotal }))

      const after = await firstValueFrom(this.store.select((s: { welds: WeldState }) => s.welds))
      const mergedBatch = after.batches.find((b) => b.id === batchId)
      const mergedCount = (mergedBatch?.appliedOpIds.length ?? 0) - before.length
      const dupCount = ops.length - mergedCount
      const newConflicts = (mergedBatch?.arbitration ?? []).filter((a) => a.state === '待裁决' && !pendingBefore.has(a.id)).length
      const detail = mergedCount > 0
        ? `合并 ${mergedCount} 条${dupCount ? `，重复操作号 ${dupCount} 条未追加审计` : ''}${newConflicts ? `，${newConflicts} 条后到内容进入待裁决区` : ''}`
        : `全部 ${ops.length} 条操作号已存在，按幂等忽略，未追加审计`
      this.message.add({
        severity: newConflicts ? 'warn' : 'success',
        summary: mergedCount > 0 ? `批次 ${batchId} 补传完成` : '重复补传已忽略',
        detail,
      })
      return true
    } finally {
      this.running.delete(batchId)
    }
  }

  /** 回站后重放某条操作号：已合并则提示幂等忽略，不产生审计 */
  replay(op: BatchOp) {
    this.store.dispatch(A.replayOp({ batchId: op.batchId, op }))
    this.message.add({
      severity: 'info',
      summary: `操作号 ${op.opId} 已存在`,
      detail: '按操作号合并命中已有结果，重复操作不追加审计',
    })
  }
}
