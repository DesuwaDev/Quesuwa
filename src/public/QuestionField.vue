<script setup>
import { computed } from 'vue';
import { t } from '../i18n.js';
import TextAnswer from './fields/TextAnswer.vue';
import ChoiceAnswer from './fields/ChoiceAnswer.vue';
import ScaleAnswer from './fields/ScaleAnswer.vue';
import MatrixAnswer from './fields/MatrixAnswer.vue';
import RankingAnswer from './fields/RankingAnswer.vue';
import FileAnswer from './fields/FileAnswer.vue';
import SelectAnswer from './fields/SelectAnswer.vue';
import AppIcon from '../components/AppIcon.vue';

const props = defineProps({ field: Object, number: Number, state: Object, seed: String, disabled: Boolean });
const error = computed(() => props.state.errors[props.field.id]);
const hintId = computed(() => props.field.description ? 'hint-' + props.field.id : undefined);
const errorId = computed(() => error.value ? 'error-' + props.field.id : undefined);
const describedBy = computed(() => [hintId.value, errorId.value].filter(Boolean).join(' ') || undefined);
const textTypes = ['short', 'long', 'email', 'phone', 'url', 'number', 'date', 'time'];
const scaleTypes = ['rating', 'scale', 'nps'];
</script>

<template>
  <div v-if="field.type === 'statement'" class="statement-block">
    <h3>{{ field.label }}</h3>
    <p v-if="field.description" class="preserve">{{ field.description }}</p>
  </div>
  <fieldset v-else class="question" :class="{ invalid: error }" :data-field="field.id">
    <legend class="question-title">
      <span v-if="number" class="question-number">{{ number }}</span>
      <span class="question-label">{{ field.label }}<span v-if="field.required" class="required-mark" :title="t('common.required')">*</span></span>
      <span v-if="!field.required" class="optional-tag">{{ t('common.optional') }}</span>
    </legend>
    <p v-if="field.description" :id="hintId" class="question-hint preserve">{{ field.description }}</p>
    <TextAnswer v-if="textTypes.includes(field.type)" :field="field" :state="state" :disabled="disabled" :described-by="describedBy" :invalid="Boolean(error)" />
    <ChoiceAnswer v-else-if="field.type === 'single' || field.type === 'multi'" :field="field" :state="state" :seed="seed" :disabled="disabled" :described-by="describedBy" />
    <SelectAnswer v-else-if="field.type === 'select'" :field="field" :state="state" :seed="seed" :disabled="disabled" :described-by="describedBy" :invalid="Boolean(error)" />
    <ScaleAnswer v-else-if="scaleTypes.includes(field.type)" :field="field" :state="state" :disabled="disabled" :described-by="describedBy" />
    <MatrixAnswer v-else-if="field.type === 'matrix'" :field="field" :state="state" :disabled="disabled" :described-by="describedBy" />
    <RankingAnswer v-else-if="field.type === 'ranking'" :field="field" :state="state" :seed="seed" :disabled="disabled" :described-by="describedBy" />
    <FileAnswer v-else-if="field.type === 'file'" :field="field" :state="state" :disabled="disabled" :described-by="describedBy" />
    <p v-if="error" :id="errorId" class="field-error" role="alert"><AppIcon name="alert" :size="14" />{{ t(error.code, error.params) }}</p>
  </fieldset>
</template>
