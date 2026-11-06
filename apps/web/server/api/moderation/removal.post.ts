import { createJournaledRemovalHandler } from '../../utils/journaled-removal'
import { firebaseAdmin } from '../../utils/firebase-admin'

export default createJournaledRemovalHandler(event => useRuntimeConfig(event), firebaseAdmin)
