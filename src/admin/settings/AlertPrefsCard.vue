<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { t } from '../../i18n.js';
import { api, session } from '../../lib/api.js';
import { notify, notifyError } from '../../lib/feedback.js';
import { loadMessaging, messaging } from '../../lib/messaging.js';
import AppIcon from '../../components/AppIcon.vue';
import ToggleSwitch from '../../components/ToggleSwitch.vue';

const props = defineProps({ prefs: { type: Object, default: null } });
const email = ref(session.user.email || ''), value = ref(null), baseline = ref(''), forms = ref([]), saving = ref(false);
const snapshot = () => JSON.stringify({ email: email.value.trim(), prefs: value.value });
const dirty = computed(() => Boolean(value.value) && snapshot() !== baseline.value);
const wantsMail = computed(() => value.value && (value.value.newResponse || value.value.ticketReply || value.value.digest));

watch(() => props.prefs, prefs => {
  if (!prefs) return;
  value.value = { ...prefs, forms: [...prefs.forms] };
  baseline.value = snapshot();
}, { immediate: true });

function toggleForm(id, checked) {
  const list = new Set(value.value.forms);
  if (checked) list.add(id); else list.delete(id);
  value.value.forms = [...list];
}

async function save() {
  saving.value = true;
  try {
    const data = await api('/admin/me', { method: 'PATCH', body: { email: email.value.trim(), notifyPrefs: value.value } });
    session.user = data.user;
    value.value = { ...data.prefs, forms: [...data.prefs.forms] };
    email.value = data.user.email;
    baseline.value = snapshot();
    notify('prefs.saved');
  } catch (error) { notifyError(error); }
  finally { saving.value = false; }
}

onMounted(async () => {
  loadMessaging();
  try { forms.value = (await api('/admin/forms')).map(form => ({ id: form.id, title: form.title })); } catch (error) { notifyError(error); }
});
</script>

<template>
  <section class="card settings-card">
    <header class="card-header"><h2><AppIcon name="mail" :size="18" />{{ t('prefs.title') }}</h2></header>
    <p class="muted small">{{ t('prefs.intro') }}</p>
    <p v-if="messaging.loaded && !messaging.alertMail" class="banner info"><AppIcon name="info" :size="16" /><span>{{ t('prefs.smtpOff') }}</span></p>
    <form v-if="value" class="stack-form" @submit.prevent="save">
      <label class="field">
        <span class="field-label">{{ t('prefs.email') }}</span>
        <input v-model="email" class="input" type="email" maxlength="254" autocomplete="email" :placeholder="t('prefs.emailPlaceholder')" />
        <small v-if="wantsMail && !email.trim()" class="field-error">{{ t('prefs.emailNeeded') }}</small>
      </label>
      <div class="switch-list">
        <ToggleSwitch v-model="value.newResponse" :label="t('prefs.newResponse')" :hint="t('prefs.newResponseHint')" />
        <ToggleSwitch v-model="value.ticketReply" :label="t('prefs.ticketReply')" :hint="t('prefs.ticketReplyHint')" />
        <ToggleSwitch v-model="value.digest" :label="t('prefs.digest')" :hint="t('prefs.digestHint')" />
      </div>
      <fieldset v-if="value.newResponse || value.ticketReply" class="plain-fieldset">
        <legend class="field-label">{{ t('prefs.scope') }}</legend>
        <div class="chip-group">
          <label class="radio-chip"><input v-model="value.scope" type="radio" value="all" />{{ t('prefs.scopeAll') }}</label>
          <label class="radio-chip"><input v-model="value.scope" type="radio" value="selected" />{{ t('prefs.scopeSelected') }}</label>
        </div>
        <div v-if="value.scope === 'selected'" class="form-pick-list">
          <label v-for="form in forms" :key="form.id" class="check-row"><input type="checkbox" :checked="value.forms.includes(form.id)" @change="toggleForm(form.id, $event.target.checked)" />{{ form.title }}</label>
          <p v-if="!forms.length" class="muted small">{{ t('prefs.noForms') }}</p>
        </div>
      </fieldset>
      <button type="submit" class="button primary align-start" :disabled="saving || !dirty">{{ t('common.save') }}</button>
    </form>
  </section>
</template>
