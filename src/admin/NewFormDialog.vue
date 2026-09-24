<script setup>
import { ref } from 'vue';
import { t } from '../i18n.js';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { notifyError, notify } from '../lib/feedback.js';
import { templates, buildTemplate } from '../lib/templates.js';
import ModalFrame from '../components/ModalFrame.vue';
import AppIcon from '../components/AppIcon.vue';

const emit = defineEmits(['close', 'created']);
const busy = ref(false);

async function create(definition, messageKey = 'forms.created') {
  busy.value = true;
  try {
    const form = await api('/admin/forms', { method: 'POST', body: definition });
    notify(messageKey);
    emit('created', form);
    emit('close');
    navigate('/admin/forms/' + form.id + '/edit');
  } catch (error) { notifyError(error); }
  finally { busy.value = false; }
}

async function importFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 1024 * 1024) return notifyError({ code: 'forms.importInvalid' });
  let definition;
  try { definition = JSON.parse(await file.text()); } catch { return notifyError({ code: 'forms.importInvalid' }); }
  if (!definition || typeof definition !== 'object' || !Array.isArray(definition.fields)) return notifyError({ code: 'forms.importInvalid' });
  const { slug: _slug, id: _id, ...rest } = definition;
  create({ ...rest, state: 'draft' }, 'forms.imported');
}
</script>

<template>
  <ModalFrame :title="t('forms.newTitle')" size="lg" @close="emit('close')">
    <p class="muted">{{ t('forms.newIntro') }}</p>
    <div class="template-grid" :aria-busy="busy">
      <button v-for="item in templates" :key="item.key" type="button" class="template-card" :class="{ blank: item.key === 'blank' }" :disabled="busy" @click="create(buildTemplate(item.key))">
        <span class="template-icon"><AppIcon :name="item.icon" :size="20" /></span>
        <strong>{{ t(item.title) }}</strong>
        <span>{{ t(item.text) }}</span>
      </button>
    </div>
    <template #actions>
      <label class="button ghost file-button" :class="{ disabled: busy }">
        <AppIcon name="upload" :size="16" />{{ t('forms.import') }}
        <input type="file" accept=".json,application/json" :disabled="busy" @change="importFile" />
      </label>
      <span class="spacer"></span>
      <button type="button" class="button" @click="emit('close')">{{ t('common.cancel') }}</button>
    </template>
  </ModalFrame>
</template>
