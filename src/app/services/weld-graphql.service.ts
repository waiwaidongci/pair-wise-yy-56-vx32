import { inject, Injectable } from '@angular/core'
import { Apollo, gql } from 'apollo-angular'
import { map } from 'rxjs'
import type { BatchOp, InspectionBatch, InspectionPlan, Weld } from '../types'

const WELDS_QUERY = gql`query Welds {
  welds { id drawing component joint method welder qualification qualificationValid inspectionRatio requiredRatio status x y repairs defects { id position type length level method report } }
  plans { id date method weldIds inspector state }
  batches { id planId revision status complete }
  offlineOps { opId batchId weldId kind inspector occurredAt baseRevision checkpoint summary }
}`

export interface WorkbenchData {
  welds: Weld[]
  plans: InspectionPlan[]
  batches: InspectionBatch[]
  offlineOps: BatchOp[]
}

@Injectable({ providedIn: 'root' })
export class WeldGraphqlService {
  private readonly apollo = inject(Apollo)
  load() {
    return this.apollo.watchQuery<WorkbenchData>({ query: WELDS_QUERY, fetchPolicy: 'network-only' })
      .valueChanges.pipe(map((result) => result.data))
  }
}
