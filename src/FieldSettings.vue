<script setup>
import { computed } from 'vue';
import { t } from './i18n.js';
import { choiceTypes } from './shared.js';
import { fileKinds, fileKindKeys } from './form-rules.js';
const props = defineProps({ field: Object, earlier: Array });
const conditions = computed(() => props.earlier.filter(f => choiceTypes.includes(f.type)));
const parent = computed(() => props.earlier.find(f => f.id === props.field.condition?.fieldId));
function setCondition(id) { props.field.condition = id ? { fieldId: id, value: '' } : null; }
</script>
<template>
  <details class="field-advanced">
    <summary>{{ t('settings.fieldRules') }}</summary>
    <div class="settings-grid">
      <template v-if="['short', 'long', 'email', 'url', 'number', 'date'].includes(field.type)">
        <label class="stack-label"><span>{{ t('settings.placeholder') }}</span><input v-model="field.placeholder" maxlength="200" /></label>
        <label v-if="['short', 'long', 'email', 'url'].includes(field.type)" class="stack-label"><span>{{ t('settings.maxLength') }}</span><input type="number" v-model.number="field.maxLength" min="1" :max="field.type === 'long' ? 10000 : 1000" /></label>
      </template>
      <template v-if="field.type === 'number'">
        <label class="stack-label"><span>{{ t('settings.min') }}</span><input type="number" v-model.number="field.min" /></label>
        <label class="stack-label"><span>{{ t('settings.max') }}</span><input type="number" v-model.number="field.max" /></label>
      </template>
      <label v-if="field.type === 'rating'" class="stack-label"><span>{{ t('settings.ratingMax') }}</span><input type="number" v-model.number="field.ratingMax" min="2" max="10" /></label>
      <template v-if="field.type === 'file'">
        <label class="stack-label"><span>{{ t('settings.maxFiles') }}</span><input type="number" v-model.number="field.maxFiles" min="1" max="3" /></label>
        <label class="stack-label"><span>{{ t('settings.maxFileMB') }}</span><input type="number" v-model.number="field.maxFileMB" min="1" max="10" /></label>
        <div class="stack-label"><span>{{ t('settings.fileKinds') }}</span><label v-for="kind in fileKinds" :key="kind" class="check-row"><input type="checkbox" v-model="field.fileKinds" :value="kind" />{{ t(fileKindKeys[kind]) }}</label></div>
      </template>
      <label class="stack-label"><span>{{ t('settings.condition') }}</span><select :value="field.condition?.fieldId || ''" @change="setCondition($event.target.value)"><option value="">{{ t('settings.always') }}</option><option v-for="f in conditions" :key="f.id" :value="f.id">{{ f.label }}</option></select></label>
      <label v-if="parent" class="stack-label"><span>{{ t('settings.equals') }}</span><select v-model="field.condition.value"><option v-for="option in parent.options" :key="option">{{ option }}</option></select></label>
    </div>
  </details>
</template>
