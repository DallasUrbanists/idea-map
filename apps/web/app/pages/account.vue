<script setup lang="ts">
const { $browserAuth: client } = useNuxtApp()
const email = ref('')
const password = ref('')
const signedIn = useState<string | null>('auth-email', () => null)
const authError = useState<string>('auth-error', () => '')
const message = ref('')
const busy = ref(false)
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
      <button :disabled="busy || !client" @click="run('verify')">Send verification email</button>
      <button :disabled="busy || !client" @click="run('logout')">Sign out on this device</button>
    </template>
    <form v-else @submit.prevent="run('login')">
      <label for="email">Email</label>
      <input id="email" v-model="email" type="email" autocomplete="email" required>
      <label for="password">Password</label>
      <input id="password" v-model="password" type="password" autocomplete="current-password" required>
      <button :disabled="busy || !client">Sign in</button>
      <button type="button" :disabled="busy || !client" @click="run('register')">Create account</button>
      <button type="button" :disabled="busy || !client" @click="run('google')">Continue with Google</button>
      <button type="button" :disabled="busy || !client || !email" @click="run('reset')">Reset password</button>
    </form>
  </main>
</template>
