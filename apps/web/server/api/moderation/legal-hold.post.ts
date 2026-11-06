import { createJournaledHoldPlacementHandler } from '../../utils/journaled-removal'
import { firebaseAdmin } from '../../utils/firebase-admin'

export default createJournaledHoldPlacementHandler(event => useRuntimeConfig(event), firebaseAdmin)
