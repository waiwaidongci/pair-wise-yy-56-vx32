import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { RouterLink } from '@angular/router'
import { Store } from '@ngrx/store'
import { TagModule } from 'primeng/tag'
import { selectBatchSummary } from '../store/selectors'

@Component({
  selector: 'app-revision-strip',
  standalone: true,
  imports: [CommonModule, RouterLink, TagModule],
  template: `
    <section class="rev-strip" *ngIf="summary$ | async as s">
      <div class="rev-item"><span>当前头修订</span><b>v{{ s.headRevision }}</b></div>
      <div class="rev-item" [class.hot]="s.pendingArbitration > 0">
        <span>待裁决冲突</span><b>{{ s.pendingArbitration }}</b>
        <a routerLink="/approvals" *ngIf="s.pendingArbitration > 0">去裁决</a>
      </div>
      <div class="rev-item"><span>有效签字快照</span><b>{{ s.lockedCount }}</b></div>
      <div class="rev-item" [class.hot]="s.invalidSnapshotCount > 0"><span>失效待复核</span><b>{{ s.invalidSnapshotCount }}</b></div>
      <div class="rev-item" [class.hot]="s.halfCount > 0"><span>传输中半份批次</span><b>{{ s.halfCount }}</b><small>不进总览</small></div>
      <div class="rev-note">
        <p-tag [value]="s.pendingArbitration > 0 ? '存在后到记录待裁决' : '无冲突'" [severity]="s.pendingArbitration > 0 ? 'warn' : 'success'" />
        <small>总览 · 构件地图 · 审核页共用同一修订与待裁决口径</small>
      </div>
    </section>
  `,
  styles: [`
    .rev-strip{display:flex;flex-wrap:wrap;gap:10px;align-items:stretch;background:#0f172a;color:#e2e8f0;border-radius:8px;padding:12px 16px;margin-bottom:16px}
    .rev-item{display:flex;flex-direction:column;gap:2px;padding:2px 18px;border-right:1px solid #1e293b;min-width:118px}
    .rev-item:last-of-type{border-right:none}
    .rev-item span{font-size:11px;color:#94a3b8;letter-spacing:.5px}
    .rev-item b{font-size:21px;line-height:1.1}
    .rev-item small{font-size:10px;color:#f59e0b}
    .rev-item.hot b{color:#fbbf24}
    .rev-item a{font-size:11px;color:#60a5fa;text-decoration:none}
    .rev-note{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:5px;justify-content:center}
    .rev-note small{color:#94a3b8;font-size:11px}
    @media(max-width:900px){.rev-item{border-right:none;min-width:96px}.rev-note{width:100%;align-items:flex-start;margin-left:0}}
  `],
})
export class RevisionStripComponent {
  private readonly store = inject(Store)
  readonly summary$ = this.store.select(selectBatchSummary)
}
