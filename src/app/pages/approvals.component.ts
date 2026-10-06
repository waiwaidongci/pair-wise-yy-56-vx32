import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Store } from '@ngrx/store'
import { ButtonModule } from 'primeng/button'
import { TimelineModule } from 'primeng/timeline'
import { TagModule } from 'primeng/tag'
import { MessageService } from 'primeng/api'
import { WeldState } from '../store/weld.reducer'
import { RevisionStripComponent } from '../components/revision-strip.component'
import { selectBatchSummary } from '../store/selectors'
import * as A from '../store/weld.actions'
import { timeLabel } from '../store/batch.model'
import type { InspectionBatch } from '../types'

const SIGNER = '周敏（质量负责人）'

@Component({
  selector:'app-approvals', standalone:true,
  imports:[CommonModule,ButtonModule,TimelineModule,TagModule,RevisionStripComponent],
  template:`
    <main class="page">
      <div class="page-head"><div><p class="eyebrow">签字、裁决与追溯</p><h1>批次审核与锁定</h1><p>先到版本默认生效；后到内容在待裁决区逐条采纳/驳回。签字生成只读快照，资质或检测比例改动只令相关快照失效。</p></div></div>
      <app-revision-strip />

      <section class="card arb-card" *ngIf="pendingItems.length">
        <h2 class="panel-title"><i class="pi pi-gavel"></i> 待裁决区（{{pendingItems.length}} 条 · 与总览/地图同一数字）</h2>
        <div class="arb" *ngFor="let item of pendingItems">
          <div class="arb-main">
            <div class="arb-head"><b>{{item.batchId}} · {{item.weldId}}</b><p-tag value="v{{item.revision}} 后到" severity="warn" /></div>
            <p class="reason">{{item.reason}}</p>
            <div class="ops">
              <div class="op win"><small>先到 · 已生效</small><b>{{item.winOpId}} · {{item.winnerInspector}}</b></div>
              <div class="op lose"><small>后到 · 待裁决</small><b>{{item.loseOpId}} · {{item.loserInspector}}</b><p>{{item.loserOp.summary}}<span>{{item.loserOp.kind}} · {{time(item.loserOp.occurredAt)}}</span></p></div>
            </div>
          </div>
          <div class="arb-actions"><p-button label="采纳后到版本" icon="pi pi-check" severity="warn" (onClick)="decide(item.batchId,item.id,true)" /><p-button label="驳回（维持先到）" icon="pi pi-times" severity="secondary" [outlined]="true" (onClick)="decide(item.batchId,item.id,false)" /></div>
        </div>
      </section>

      <div class="grid-2">
        <section class="card">
          <h2 class="panel-title">检测批次（计划 + 焊缝 + 缺陷/返修 + 签字快照）</h2>
          <div class="batch" *ngFor="let batch of state.batches">
            <div class="batch-head">
              <div><b>{{batch.id}}</b><small>{{batch.plan.id}} · {{batch.plan.date}} · {{batch.plan.method}} · 检测员 {{batch.plan.inspector}}</small></div>
              <div class="batch-tags"><p-tag value="v{{batch.revision}}" severity="info" /><p-tag [value]="batch.status" [severity]="batch.status === '已锁定' ? 'success' : batch.status === '待复核' ? 'warn' : 'info'" /></div>
            </div>
            <p class="halfline" *ngIf="!batch.complete"><i class="pi pi-exclamation-triangle"></i> 检查点 {{batch.checkpointsAcked.length}}/{{batch.checkpointsTotal}}，半份批次不进总览：{{batch.lastError || '等待断点续传'}}</p>
            <div class="results">
              <div class="res" *ngFor="let r of batch.results.slice(0,4)"><span>{{r.weldId}} · {{r.kind}}</span><b [class.arb]="r.source === '冲突裁决采纳'">{{r.opId}} v{{r.revision}}<small *ngIf="r.source === '冲突裁决采纳'">（裁决采纳）</small></b><small>{{r.inspector}} · {{time(r.occurredAt)}}</small></div>
            </div>
            <div class="snapshot" [class.invalid]="batch.snapshot && !batch.snapshot.valid">
              <ng-container *ngIf="batch.snapshot as s">
                <i class="pi" [class.pi-lock]="s.valid" [class.pi-unlock]="!s.valid"></i>
                <div><b>{{s.signer}} · v{{s.revision}} 签字</b><small>{{s.hash}} · {{time(s.signedAt)}}</small><small class="invalid-reason" *ngIf="!s.valid">快照已失效：{{s.invalidReason}} —— 回到待复核</small></div>
              </ng-container>
              <span class="muted" *ngIf="!batch.snapshot">尚未签字，补传完成后可锁定</span>
            </div>
            <div class="batch-foot">
              <p-button [label]="canSign(batch) ? '签字锁定（只读快照）' : '已锁定 / 传输中'" icon="pi pi-lock" [disabled]="!canSign(batch)" (onClick)="sign(batch.id)" />
              <small *ngIf="batch.snapshot?.valid">锁定后再补传将自动令该快照失效，其他批次不受影响</small>
            </div>
          </div>
        </section>

        <aside class="card">
          <h2 class="panel-title">规则变更演练</h2>
          <p class="muted">改动焊工资质或检测比例后，仅“包含该焊缝且已锁定”的批次快照立即失效、回到待复核；其他批次不受影响。</p>
          <div class="rule" *ngFor="let w of ruleWelds">
            <div class="rule-head"><b>{{w.id}} · {{w.welder}}</b><div><p-tag [value]="w.qualificationValid ? '资质有效' : '资质失效'" [severity]="w.qualificationValid ? 'success' : 'danger'" /><p-tag value="比例 {{w.inspectionRatio}}%/{{w.requiredRatio}}%" severity="info" /></div></div>
            <div class="rule-btns">
              <p-button size="small" [label]="w.qualificationValid ? '标记资质失效' : '恢复资质有效'" [severity]="w.qualificationValid ? 'danger' : 'success'" [outlined]="true" (onClick)="toggleQual(w.id, w.qualificationValid)" />
              <p-button size="small" [label]="w.inspectionRatio < w.requiredRatio ? '比例提升至 ' + w.requiredRatio + '%' : '比例下调为 10%'" severity="warn" [outlined]="true" (onClick)="toggleRatio(w)" />
            </div>
            <small *ngIf="affectedBatches(w.id).length" class="affected">将/已影响锁定批次：{{affectedBatches(w.id).join('、')}}</small>
          </div>
        </aside>
      </div>

      <section class="card mt-4">
        <h2 class="panel-title">完整审计时间线（重复操作号不产生记录）</h2>
        <p-timeline [value]="state.audit" align="left" styleClass="audit-line">
          <ng-template #content let-event>
            <div class="audit" [class.danger]="event.action.includes('失效') || event.action.includes('冲突')"><div><b>{{event.actor}} · {{event.action}}</b><span>{{event.time}}</span></div><p><strong>{{event.target}}</strong> {{event.detail}}</p></div>
          </ng-template>
        </p-timeline>
      </section>
    </main>
  `,
  styles:[`
    .arb-card{margin-bottom:16px;border-left:4px solid #d97706}
    .arb{display:flex;justify-content:space-between;gap:14px;padding:14px 0;border-bottom:1px solid #edf0f5}.arb-head{display:flex;gap:10px;align-items:center}.reason{margin:7px 0;font-size:13px;color:#7c2d12}
    .ops{display:grid;grid-template-columns:1fr 1fr;gap:10px}.op{border-radius:7px;padding:10px;font-size:13px}.op small{display:block;color:#7a8798;margin-bottom:3px}.op b{font-size:13px}.op.win{background:#f0fdf4;border:1px solid #bbf7d0}.op.lose{background:#fffbeb;border:1px solid #fde68a}.op.lose p{margin:6px 0 0;font-size:12px}.op.lose span{display:block;color:#92400e;margin-top:3px}
    .arb-actions{display:flex;flex-direction:column;gap:8px;justify-content:center;min-width:170px}
    .batch{border:1px solid #e1e7ef;border-radius:8px;padding:13px;margin-bottom:13px}.batch-head{display:flex;justify-content:space-between;gap:10px}.batch-head small{display:block;color:#7a8798;margin-top:3px}.batch-tags{display:flex;gap:6px;align-items:flex-start}
    .results{margin:10px 0;display:grid;gap:6px}.res{display:grid;grid-template-columns:1fr 1.2fr 1fr;gap:8px;font-size:13px;background:#f8fafc;border-radius:6px;padding:7px 10px}.res small{color:#7a8798}.res b.arb{color:#b45309}
    .snapshot{display:flex;gap:9px;align-items:flex-start;background:#f8fafc;border-radius:7px;padding:10px;font-size:13px}.snapshot i{color:#16a34a}.snapshot.invalid{background:#fef2f2;border:1px solid #fecaca}.snapshot.invalid i{color:#dc2626}.snapshot b,.snapshot small{display:block}.snapshot small{color:#7a8798;margin-top:2px}.snapshot .invalid-reason{color:#dc2626}
    .batch-foot{display:flex;align-items:center;gap:12px;margin-top:10px}.batch-foot small{color:#7a8798;font-size:12px}.muted{color:#7a8798;font-size:13px}
    .halfline{background:#fffbeb;border:1px solid #fde68a;color:#b45309;border-radius:6px;padding:8px;font-size:13px;margin:8px 0}
    .rule{padding:12px 0;border-bottom:1px solid #edf0f5}.rule-head{display:flex;justify-content:space-between;align-items:center}.rule-head>div{display:flex;gap:6px}.rule-btns{display:flex;gap:8px;margin-top:9px}.affected{display:block;color:#dc2626;margin-top:7px;font-size:12px}
    .audit{background:#fff;border:1px solid #e1e7ef;border-radius:6px;padding:10px}.audit>div{display:flex;justify-content:space-between}.audit span{color:#7a8798;font-size:12px}.audit p{margin:5px 0 0;font-size:13px}.audit.danger{border-color:#fde68a;background:#fffdf5}
    .mt-4{margin-top:16px}@media(max-width:760px){.arb{flex-direction:column}.ops{grid-template-columns:1fr}.res{grid-template-columns:1fr}}
  `],
})
export class ApprovalsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  private readonly message = inject(MessageService)
  state!: WeldState
  time = timeLabel

  constructor() { this.store.select('welds').subscribe((state) => { this.state = state }) }

  get pendingItems() {
    return (this.state?.batches ?? []).flatMap((b) => b.arbitration.filter((a) => a.state === '待裁决').map((a) => ({ ...a })))
  }
  get ruleWelds() {
    const ids = new Set(['W-109', 'W-104', 'W-112'])
    return (this.state?.welds ?? []).filter((w) => ids.has(w.id))
  }
  canSign(batch: InspectionBatch) { return batch.complete && batch.status !== '已锁定' }
  affectedBatches(weldId: string) {
    return (this.state?.batches ?? []).filter((b) => b.welds.includes(weldId) && b.snapshot && !b.snapshot.valid).map((b) => b.id)
  }

  decide(batchId: string, itemId: string, accept: boolean) {
    this.store.dispatch(A.resolveArbitration({ batchId, itemId, accept, signer: SIGNER }))
    this.message.add({ severity: accept ? 'warn' : 'success', summary: accept ? '已采纳后到版本' : '已驳回，维持先到版本', detail: `${batchId} 修订 +1` })
  }
  sign(batchId: string) {
    this.store.dispatch(A.signBatch({ batchId, signer: SIGNER }))
    this.message.add({ severity: 'success', summary: '批次已签字锁定', detail: `${batchId} 生成只读快照` })
  }
  toggleQual(weldId: string, currentlyValid: boolean) {
    const next = !currentlyValid
    this.store.dispatch(A.ruleChanged({
      weldId,
      patch: { qualificationValid: next },
      reason: next ? '焊工资质恢复有效' : '焊工资质标记失效（证书 2026-10-01 到期）',
    }))
  }
  toggleRatio(w: { id: string; inspectionRatio: number; requiredRatio: number }) {
    const raise = w.inspectionRatio < w.requiredRatio
    this.store.dispatch(A.ruleChanged({
      weldId: w.id,
      patch: raise ? { inspectionRatio: w.requiredRatio } : { inspectionRatio: 10 },
      reason: raise ? `检测比例由 ${w.inspectionRatio}% 提升到 ${w.requiredRatio}%（规范要求）` : '检测比例下调为 10%（计划变更）',
    }))
  }
}
