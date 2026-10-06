import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Store } from '@ngrx/store'
import { ButtonModule } from 'primeng/button'
import { TimelineModule } from 'primeng/timeline'
import { TagModule } from 'primeng/tag'
import { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'
import type { AdjudicationItem, InspectionBatch } from '../types'

@Component({
  selector:'app-approvals', standalone:true, imports:[CommonModule,ButtonModule,TimelineModule,TagModule],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">签字、版本与追溯</p><h1>逐段确认与锁定</h1><p>检测计划、焊缝、缺陷、返修结果与签字快照绑成可修订批次；锁定后生成只读快照，变更即失效。</p></div><p-button [label]="state.locked ? '全部已锁定' : '一键锁定待复核批次'" icon="pi pi-lock" [disabled]="state.locked" (onClick)="lockAll()" /></div>
      <div class="grid-2"><section class="card"><h2 class="panel-title">待审核焊缝</h2><div class="review" *ngFor="let weld of reviewWelds"><div><b>{{weld.id}} · {{weld.component}}</b><small>{{weld.method}} · {{weld.welder}} · 返修 {{weld.repairs}} 次</small></div><p-tag [value]="weld.status" [severity]="weld.status === '待复检' ? 'warn' : 'danger'" /><p-button label="要求复检" severity="danger" text size="small" /><p-button label="确认合格" size="small" (onClick)="confirm(weld.id)" /></div><p-button label="导出质量追溯包" icon="pi pi-file-export" severity="secondary" styleClass="w-full" /></section>
      <aside class="card"><h2 class="panel-title">完整审计时间线</h2><p-timeline [value]="state.audit" align="left"><ng-template #content let-event><div class="audit"><div><b>{{event.actor}} · {{event.action}}</b><span>{{event.time}}</span></div><p><strong>{{event.target}}</strong> {{event.detail}}</p></div></ng-template></p-timeline></aside></div>

      <section class="card mt-4"><h2 class="panel-title">待裁决区 <p-tag [value]="pendingAdjudication + ' 项待裁决'" [severity]="pendingAdjudication ? 'danger' : 'success'" /></h2><p class="muted">两名检测员同时修改同一焊缝时，先到版本已生效，后到内容进入此处等待裁决；裁决前不覆盖任何已合并结果。</p><div class="adj" *ngFor="let item of state.adjudication"><div class="adj-main"><b>{{item.weldId}} · 操作号 {{item.opId}}</b><small>{{item.batchId}} · {{item.time}} · {{item.reason}}</small><small class="muted">后到内容：{{item.incoming.kind}}<span *ngIf="item.incoming.status"> · {{item.incoming.status}}</span><span *ngIf="item.incoming.note"> · {{item.incoming.note}}</span></small></div><p-tag [value]="item.status" [severity]="item.status === '待裁决' ? 'warn' : item.status === '已采纳' ? 'success' : 'danger'" /><ng-container *ngIf="item.status === '待裁决'"><p-button label="采纳并入" size="small" (onClick)="decide(item,'采纳')" /><p-button label="驳回" severity="danger" size="small" text (onClick)="decide(item,'驳回')" /></ng-container></div><p class="muted" *ngIf="!state.adjudication.length">暂无并发冲突。</p></section>

      <section class="card mt-4"><h2 class="panel-title">检测批次与签字快照</h2><div class="batch" *ngFor="let batch of state.batches"><div class="batch-head"><div><b>{{batch.id}}</b><small>计划 {{batch.planId}} · 修订 v{{batch.revision}} · {{batch.items.length}} 条结果 · 检查点 v{{batch.checkpoint.revision}}</small></div><p-tag [value]="batch.state" [severity]="batchStateSeverity(batch)" /></div><div class="batch-items"><span *ngFor="let item of batch.items" class="chip">{{item.opId}} · {{item.weldId}} · v{{item.revision}}</span></div><div class="batch-foot"><ng-container *ngIf="batch.snapshot"><span class="snap" [class.invalid]="batch.snapshot.status === '已失效'"><i></i>{{batch.snapshot.status === '已锁定' ? '签字快照有效' : '快照已失效'}} · {{batch.snapshot.signer}} · v{{batch.snapshot.revision}} · {{batch.snapshot.signedAt}}<em *ngIf="batch.snapshot.reason">（{{batch.snapshot.reason}}）</em></span></ng-container><span class="spacer"></span><p-button label="签字锁定本批" icon="pi pi-lock" size="small" [disabled]="batch.state === '已锁定'" (onClick)="lock(batch.id)" /></div></div></section>

      <section class="card mt-4"><h2 class="panel-title">变更影响模拟</h2><p class="muted">焊工资质或检测比例改动后，仅失效包含该焊缝的锁定快照并回到待复核，其他批次不受影响。</p><div class="sim-row"><div><b>焊工资质变更</b><small>焊缝 W-104（刘强）资质过期 → 仅失效包含 W-104 的批次</small></div><p-button label="变更 W-104 资质" icon="pi pi-user-edit" size="small" (onClick)="qualification()" /></div><div class="sim-row"><div><b>检测比例变更</b><small>焊缝 W-107 检测比例调整为 10% → 仅失效包含 W-107 的批次</small></div><p-button label="变更 W-107 比例" icon="pi pi-percentage" size="small" (onClick)="ratio()" /></div></section>

      <section class="card mt-4"><h2 class="panel-title">版本快照</h2><div class="snapshot"><div><b>v{{state.version}}</b><small>当前工作版本 · {{state.welds.length}} 条焊缝 · {{state.plans.length}} 个检测计划 · {{state.batches.length}} 个批次</small></div><p-tag [value]="state.locked ? '已签字锁定' : '可编辑'" [severity]="state.locked ? 'success' : 'warn'" /><p-button label="查看差异" text /></div><p>版本快照记录焊缝状态、缺陷、返修方案、附件哈希和签字人。任何后续修改必须从当前版本派生新修订，不覆盖原始检测记录。</p></section>
    </main>
  `,
  styles:[`.review{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:12px 0;border-bottom:1px solid #edf0f5}.review b,.review small{display:block}.review small{color:#7a8798;margin-top:4px}.audit{background:#fff;border:1px solid #e1e7ef;border-radius:6px;padding:10px}.audit>div{display:flex;justify-content:space-between}.audit span{color:#7a8798;font-size:12px}.audit p{margin:5px 0 0;font-size:13px}.snapshot{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:12px;background:#f8fafc;border-radius:6px}.snapshot b,.snapshot small{display:block}.snapshot small{color:#7a8798;margin-top:4px}.mt-4{margin-top:16px}.muted{color:#7a8798;font-size:13px}.adj{display:grid;grid-template-columns:1fr auto auto auto;gap:10px;align-items:center;padding:12px 0;border-bottom:1px solid #edf0f5}.adj-main{display:grid;gap:2px}.adj-main small{color:#7a8798;font-size:12px}.batch{border:1px solid #e1e7ef;border-radius:8px;padding:12px;margin-bottom:10px}.batch-head{display:flex;justify-content:space-between;align-items:center}.batch-head b,.batch-head small{display:block}.batch-head small{color:#7a8798;margin-top:2px}.batch-items{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.chip{background:#f1f5f9;border-radius:999px;padding:3px 10px;font-size:12px;color:#475569}.batch-foot{display:flex;align-items:center;gap:8px}.snap{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#16a34a}.snap i{width:8px;height:8px;border-radius:50%;background:#16a34a}.snap.invalid{color:#dc2626}.snap.invalid i{background:#dc2626}.snap em{color:#7a8798;font-style:normal}.spacer{flex:1}.sim-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #edf0f5}.sim-row b,.sim-row small{display:block}.sim-row small{color:#7a8798;margin-top:2px}@media(max-width:760px){.review{grid-template-columns:1fr auto}.review .p-button{width:100%}.adj{grid-template-columns:1fr auto}}`],
})
export class ApprovalsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  state!: WeldState
  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }
  get reviewWelds() { return (this.state?.welds ?? []).filter((item) => ['待复检','返修中','待检测'].includes(item.status)) }
  get pendingAdjudication() { return (this.state?.adjudication ?? []).filter((item) => item.status === '待裁决').length }
  batchStateSeverity(batch: InspectionBatch) {
    return batch.state === '已锁定' ? 'success' : batch.state === '待复核' ? 'warn' : batch.state === '已失效' ? 'danger' : 'info'
  }
  confirm(id: string) { this.store.dispatch(A.advanceWeld({ id, status:'合格' })) }
  lock(id: string) { this.store.dispatch(A.lockBatch({ batchId: id, signer: '质量负责人' })) }
  lockAll() { this.store.dispatch(A.lockBaseline()) }
  decide(item: AdjudicationItem, decision: '采纳' | '驳回') { this.store.dispatch(A.adjudicateItem({ id: item.id, decision })) }
  qualification() {
    const w = this.state.welds.find((x) => x.id === 'W-104')
    this.store.dispatch(A.updateWeldQualification({ id: 'W-104', valid: !w?.qualificationValid }))
  }
  ratio() {
    const w = this.state.welds.find((x) => x.id === 'W-107')
    this.store.dispatch(A.updateWeldRatio({ id: 'W-107', ratio: w && w.inspectionRatio >= w.requiredRatio ? 10 : w?.requiredRatio ?? 20 }))
  }
}
