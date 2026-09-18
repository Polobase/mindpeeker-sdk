// The one value the registration section and the time-bracket section share:
// the hash the bracket binds. SSR-safe (no SDK import), but only the ledger
// page's client components read or write it.

import { ref } from 'vue'

/** Set by LedgerRegistration whenever the form produces a valid record. */
export const currentRegistrationHash = ref<string>()

/** The title behind that hash, for the bracket's provenance line. */
export const currentRegistrationTitle = ref<string>()
