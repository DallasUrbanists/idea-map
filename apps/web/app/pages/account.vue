<script setup lang="ts">
const { $browserAuth: client } = useNuxtApp()
const email = ref('')
const password = ref('')
const signedIn = useState<string | null>('auth-email', () => null)
const authError = useState<string>('auth-error', () => '')
const message = ref('')
const busy = ref(false)
const ready = ref(false)
onMounted(() => { ready.value = true })
async function run(action: 'login' | 'register' | 'google' | 'reset' | 'verify' | 'logout') {
  if (!client || busy.value) return
  busy.value = true
  message.value = ''
  try {
    if (action === 'login') await client.login(email.value, password.value)
    if (action === 'register') { await client.register(email.value, password.value); message.value = 'Check your email for a verification link.' }
    if (action === 'google') await client.google()
    if (action === 'reset') { await client.reset(email.value); message.value = 'If the address can be used, a reset email will be sent.' }
    if (action === 'verify') { await client.verify(); message.value = 'Check your email for a verification link.' }
    if (action === 'logout') { await client.logout(); message.value = 'Signed out on this device.' }
    password.value = ''
  } catch { message.value = action === 'reset' ? 'If the address can be used, a reset email will be sent.' : 'Unable to complete that action. Check your details and try again.' }
  finally { busy.value = false }
}
</script>
<template>
  <main>
    <h1>Account</h1>
    <p role="status" aria-live="polite">{{ message || authError }}</p>
    <template v-if="signedIn">
      <p>Signed in as {{ signedIn }}</p>
      <button :disabled="!ready || busy || !client" @click="run('verify')">Send verification email</button>
      <button :disabled="!ready || busy || !client" @click="run('logout')">Sign out on this device</button>
    </template>
    <form v-else @submit.prevent="run('login')">
      <label for="email">Email</label>
      <input id="email" v-model="email" :disabled="!ready || !client" type="email" autocomplete="email" required>
      <label for="password">Password</label>
      <input id="password" v-model="password" :disabled="!ready || !client" type="password" autocomplete="current-password" required>
      <button :disabled="!ready || busy || !client">Sign in</button>
      <button type="button" :disabled="!ready || busy || !client" @click="run('register')">Create account</button>
      <button type="button" :disabled="!ready || busy || !client" @click="run('google')">Continue with Google</button>
      <button type="button" :disabled="!ready || busy || !client || !email" @click="run('reset')">Reset password</button>
    </form>
  </main>
</template>

<style scoped>
main { max-width: 32rem; margin: var(--space-8) auto; padding: 0 var(--space-4); color: var(--color-text); font: var(--font-size-body) / var(--line-body) var(--font-body); }
h1 { font: var(--font-size-display) / var(--line-heading) var(--font-heading); }
form { display: grid; gap: var(--space-2); }
input, button { box-sizing: border-box; min-height: 44px; padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-small); font: inherit; }
input { width: 100%; background: var(--color-surface); color: var(--color-text); }
button { cursor: pointer; color: var(--color-text); background: var(--color-surface-raised); }
button:disabled { opacity: 0.6; cursor: not-allowed; }
button:focus-visible, input:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px; }
</style>
