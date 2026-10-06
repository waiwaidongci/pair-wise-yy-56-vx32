import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Store } from '@ngrx/store'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { WeldState } from '../store/weld.reducer'
import { RevisionStripComponent } from '../components/revision-strip.component'
import { selectBatchSummary } from '../store/selectors'
import * as A from '../store/weld.actions'
import { timeLabel } from '../store/batch.model'
import type { Weld } from '../types'

@Component({
  selector:'app-weld-map', standalone:true,
  imports:[CommonModule,ButtonModule,TagModule,RevisionStripComponent],
  template:`
    <main class="page">
      <div class="page-head"><div><p class="eyebrow">二维构件定位</p><h1>构件焊缝地图</h1><p>颜色代表质量状态；琥珀色脉冲环表示该焊缝存在“后到记录待裁决”。生效版本与修订直接取自批次数据。</p></div></div>
      <app-revision-strip />
      <div class="map-grid">
        <section class="card drawing-card">
          <div class="drawing-head"><span>构件图 SG-07 / SG-12 · 展开示意</span><span>单位：mm · 比例 1:50</span></div>
          <svg viewBox="0 0 100 90" class="weld-map">
            <defs><pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="#dbe2ea" stroke-width=".2"/></pattern></defs>
            <rect x="3" y="3" width="94" height="84" fill="url(#grid)" stroke="#334155"/>
            <path d="M8 20H92M8 42H92M8 66H92" stroke="#94a3b8" stroke-width="4"/>
            <path d="M16 12V78M42 12V78M70 12V78M86 12V78" stroke="#cbd5e1" stroke-width="7"/>
            <g *ngFor="let weld of state.welds">
              <circle *ngIf="isArbWeld(weld.id)" [attr.cx]="weld.x" [attr.cy]="weld.y" r="5.4" fill="none" stroke="#f59e0b" stroke-width=".9" class="arb-ring" />
              <circle [attr.cx]="weld.x" [attr.cy]="weld.y" r="3.2" [attr.fill]="color(weld)" stroke="#fff" stroke-width="1" class="dot" (click)="select(weld)" />
              <text [attr.x]="weld.x+4" [attr.y]="weld.y-4" class="label">{{weld.id}}</text>
              <circle *ngFor="let defect of weld.defects" [attr.cx]="weld.x + defect.position / 30" [attr.cy]="weld.y + 4" r="1.4" fill="#dc2626" />
            </g>
            <text x="50" y="86" class="axis">构件长度方向 →</text>
          </svg>
        </section>

        <aside class="card">
          <h2 class="panel-title">焊缝明细 / 生效版本</h2>
          <div *ngIf="selected" class="detail">
            <div class="detail-head"><div><small>{{selected.drawing}}</small><h3>{{selected.id}} · {{selected.component}}</h3></div><p-tag [value]="selected.status" [severity]="selected.status === '合格' || selected.status === '已关闭' ? 'success' : selected.status === '返修中' ? 'danger' : 'warn'" /></div>
            <div class="kv"><span>焊接方法 / 焊工</span><b>{{selected.method}} · {{selected.welder}}</b></div>
            <div class="kv"><span>检测比例</span><b [class.danger]="selected.inspectionRatio < selected.requiredRatio">{{selected.inspectionRatio}}% / {{selected.requiredRatio}}%</b></div>

            <ng-container *ngIf="effective(selected.id) as eff">
              <div class="eff"><span>当前生效版本</span><b>{{eff.opId}} · v{{eff.revision}}</b><small>{{eff.inspector}} · {{time(eff.occurredAt)}}（先到生效）</small></div>
            </ng-container>
            <p class="muted" *ngIf="!effective(selected.id)">该焊缝尚无已合并的批次结果。</p>

            <div class="arb-box" *ngFor="let item of pending(selected.id)">
              <div class="arb-head"><i class="pi pi-gavel"></i><b>待裁决 · {{item.loseOpId}}</b><span>v{{item.revision}}</span></div>
              <p>{{item.reason}}</p>
              <small class="loser">后到内容（{{item.loserInspector}} · {{time(item.loserOp.occurredAt)}}）：{{item.loserOp.summary}}</small>
            </div>

            <h3>缺陷记录</h3>
            <div *ngFor="let defect of selected.defects" class="defect"><b>{{defect.id}} · {{defect.type}}</b><p>位置 {{defect.position}}% · 长度 {{defect.length}}mm · {{defect.level}} · {{defect.method}}</p></div>
            <p class="muted" *ngIf="!selected.defects.length">当前无未关闭缺陷。</p>
          </div>
          <p class="muted" *ngIf="!selected">点击地图上的焊缝查看生效版本与裁决情况。</p>
        </aside>
      </div>

      <section class="card mt-4">
        <h2 class="panel-title">同口径数字（与总览、审核页一致）</h2>
        <div class="same-num" *ngIf="summary$ | async as s">
          <div><b class="danger">{{s.pendingArbitration}}</b><span>待裁决数量</span></div>
          <div><b>v{{s.headRevision}}</b><span>头修订版本</span></div>
          <div><b>{{s.arbitrationWeldIds.length}}</b><span>涉及焊缝：{{s.arbitrationWeldIds.join('、') || '无'}}</span></div>
        </div>
      </section>
    </main>
  `,
  styles:[`
    .map-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(320px,.7fr);gap:16px}
    .drawing-card{padding:0;overflow:hidden}.drawing-head{display:flex;justify-content:space-between;padding:13px 16px;background:#f8fafc;border-bottom:1px solid #e1e7ef;color:#64748b;font-size:13px}
    .weld-map{width:100%;height:min(62vh,640px);display:block;background:#fff}.weld-map .dot{cursor:pointer}.label{font-size:2.4px;font-weight:700;fill:#334155}.axis{font-size:2.2px;fill:#94a3b8}
    .arb-ring{transform-box:fill-box;transform-origin:center;animation:ring 1.4s ease-out infinite}@keyframes ring{0%{opacity:.9;r:4.4}100%{opacity:0;r:7}}
    .detail-head{display:flex;justify-content:space-between}.detail-head small{color:#7a8798}.detail-head h3{margin:5px 0}.kv{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #edf0f5}.kv span{color:#667085}
    .eff{background:#f0fdf4;border-left:3px solid #16a34a;border-radius:5px;padding:10px;margin:10px 0}.eff span,.eff b,.eff small{display:block}.eff span{font-size:12px;color:#667085}.eff small{color:#667085;margin-top:3px}
    .arb-box{background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px;margin-top:10px}.arb-head{display:flex;align-items:center;gap:7px}.arb-head i{color:#b45309}.arb-head span{margin-left:auto;background:#fef3c7;border-radius:4px;padding:1px 7px;font-size:12px;color:#92400e}.arb-box p{margin:6px 0;font-size:13px}.arb-box .loser{color:#7c2d12;font-size:12px}
    .defect{margin-top:10px;padding:10px;background:#fff1f2;border-left:3px solid #ef4444;border-radius:5px}.defect p{margin:4px 0 0;font-size:13px}.muted{color:#7a8798;font-size:13px}
    .same-num{display:flex;gap:34px;flex-wrap:wrap}.same-num div{display:flex;flex-direction:column}.same-num b{font-size:26px}.same-num span{color:#667085;font-size:13px}
    .mt-4{margin-top:16px}
  `],
})
export class WeldMapComponent {
  readonly store = inject(Store<{ welds: WeldState }>)
  state!: WeldState
  readonly summary$ = this.store.select(selectBatchSummary)
  time = timeLabel

  constructor() { this.store.select('welds').subscribe((state) => { this.state = state }) }
  get selected() { return this.state?.welds.find((w) => w.id === this.state.selectedId) ?? this.state?.welds[0] }
  select(weld: Weld) { this.store.dispatch(A.selectWeld({ id: weld.id })) }
  color(weld: Weld) {
    if (this.isArbWeld(weld.id)) return '#d97706'
    return weld.status === '合格' || weld.status === '已关闭' ? '#16a34a' : weld.status === '返修中' || !weld.qualificationValid ? '#dc2626' : weld.status === '待复检' ? '#7c3aed' : '#f59e0b'
  }
  isArbWeld(weldId: string) {
    return (this.state?.batches ?? []).some((b) => b.arbitration.some((a) => a.weldId === weldId && a.state === '待裁决'))
  }
  effective(weldId: string) {
    return this.state?.batches.flatMap((b) => b.welds.map((w) => ({ b, w })))
      .filter((x) => x.w === weldId)
      .map((x) => x.b.effective[weldId])
      .filter(Boolean)
      .sort((a, b) => b.occurredAt - a.occurredAt)[0]
  }
  pending(weldId: string) {
    return (this.state?.batches ?? []).flatMap((b) => b.arbitration.filter((a) => a.weldId === weldId && a.state === '待裁决'))
  }
}
