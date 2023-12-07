import { ServiceImpl } from '@connectrpc/connect'
import { Service } from '../../gen/bsky_connect'
import { Database } from '../../../db'
import * as ui8 from 'uint8arrays'

export default (db: Database): Partial<ServiceImpl<typeof Service>> => ({
  async getLabels(req) {
    const { subjects, issuers } = req
    if (subjects.length === 0 || issuers.length === 0) {
      return { records: [] }
    }
    const labels = await db.db
      .selectFrom('label')
      .where('src', 'in', issuers)
      .where('uri', 'in', subjects)
      .selectAll()
      .execute()

    const records = labels.map((l) => {
      const formatted = {
        ...l,
        cid: l.cid === '' ? undefined : l.cid,
      }
      return ui8.fromString(JSON.stringify(formatted), 'utf8')
    })
    return { records }
  },
})
