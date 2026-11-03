// This endpoint and project are intentionally fixed to the local demo emulator.
const deleteUrl = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:delete?key=fake-key'

export function trackAuthTestAccounts() {
  const tokens = new Map()
  return {
    add(account, idToken) {
      if (typeof idToken !== 'string' || !idToken) throw new Error('Auth emulator did not return an account token')
      tokens.set(account, idToken)
    },
    get size() { return tokens.size },
    async cleanup() {
      let failures = 0
      for (const [account, idToken] of tokens) {
        try {
          const response = await fetch(deleteUrl, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }),
          })
          if (response.ok) tokens.delete(account)
          else failures++
        } catch { failures++ }
      }
      if (failures) throw new Error(`Failed to delete ${failures} Auth emulator test account(s)`)
    },
  }
}
