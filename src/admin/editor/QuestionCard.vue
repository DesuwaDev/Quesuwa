<script setup>
import { computed, ref } from 'vue';
import { t } from '../../i18n.js';
import { fieldTypes, layoutTypes, optionTypes } from '../../../shared/constants.js';
import { fieldIcons } from '../../components/icons.js';
import AppIcon from '../../components/AppIcon.vue';
import ToggleSwitch from '../../components/ToggleSwitch.vue';
import MenuButton from '../../components/MenuButton.vue';
import FieldOptions from './FieldOptions.vue';
import RuleSetEditor from './RuleSetEditor.vue';
import OptionLogicEditor from './OptionLogicEditor.vue';
import { changeType, repairLogic, hasLogic } from './fields.js';
import { notify } from '../../lib/feedback.js';

const props = defineProps({ field: Object, fields: Array, index: Number, number: Number, active: Boolean, readonly: Boolean });
const emit = defineEmits(['activate', 'move', 'duplicate', 'remove', 'dragstart-handle']);
const root = ref(null);
const layout = computed(() => layoutTypes.includes(props.field.type));
const showDescription = ref(Boolean(props.field.description));
const earlier = computed(() => props.fields.slice(0, props.index));
const preview = computed(() => {
  const field = props.field;
  if (optionTypes.includes(field.type)) return field.options.slice(0, 4).join(' · ') + (field.options.length > 4 ? ' …' : '');
  if (field.type === 'matrix') return t('editor.matrixSummary', { rows: field.rows.length, columns: field.columns.length });
  if (field.type === 'rating') return t('editor.ratingSummary', { max: field.ratingMax });
  if (field.type === 'scale') return (field.scaleMin ?? 1) + ' – ' + field.scaleMax;
  if (field.type === 'nps') return '0 – 10';
  return field.description;
});

function setType(type) {
  if (type === props.field.type) return;
  changeType(props.field, type);
  const repaired = repairLogic(props.fields);
  if (repaired) notify('editor.logicRepaired', { type: 'info', params: { count: repaired } });
}

function handleDrag(event) {
  if (root.value) event.dataTransfer.setDragImage(root.value, 24, 24);
  emit('dragstart-handle', event);
}
</script>

<template>
  <article ref="root" class="question-card" :class="['type-' + field.type, { active, layout }]" @click="!active && emit('activate')">
    <header class="question-card-head">
      <span v-if="!readonly" class="drag-handle" draggable="true" :title="t('editor.drag')" @dragstart="handleDrag" @click.stop><AppIcon name="grip" :size="16" /></span>
      <span class="question-index" :class="{ layout }">
        <AppIcon :name="fieldIcons[field.type]" :size="14" />
        <span v-if="number">{{ number }}</span>
      </span>
      <template v-if="!active">
        <div class="question-summary">
          <strong class="clamp-2">{{ field.label || t('editor.untitledQuestion') }}<span v-if="field.required" class="required-mark">*</span></strong>
          <span v-if="preview" class="muted small clamp-1">{{ preview }}</span>
        </div>
        <span v-if="hasLogic(field)" class="badge info" :title="t('logic.title')"><AppIcon name="branch" :size="12" />{{ t('logic.badge') }}</span>
        <span class="type-chip hide-narrow">{{ t(fieldTypes[field.type]) }}</span>
      </template>
      <template v-else>
        <select class="input select compact question-type-select" :value="field.type" :disabled="readonly" :aria-label="t('editor.type')" @change="setType($event.target.value)">
          <option v-for="(key, type) in fieldTypes" :key="type" :value="type" :disabled="type === 'file' && field.type !== 'file' && fields.filter(item => item.type === 'file').length >= 2">{{ t(key) }}</option>
        </select>
        <span class="spacer"></span>
        <ToggleSwitch v-if="!layout" v-model="field.required" class="compact" :label="t('common.required')" :disabled="readonly" />
      </template>
    </header>

    <div v-if="active" class="question-card-body">
      <label class="field">
        <span class="field-label">{{ field.type === 'section' ? t('editor.sectionTitle') : field.type === 'statement' ? t('editor.statementTitle') : t('labels.question') }}</span>
        <textarea v-model="field.label" class="input textarea autosize question-label-input" rows="1" maxlength="500" :disabled="readonly" :placeholder="t('editor.untitledQuestion')"></textarea>
      </label>
      <label v-if="showDescription || layout" class="field">
        <span class="field-label">{{ field.type === 'statement' ? t('editor.statementBody') : field.type === 'section' ? t('editor.sectionDescription') : t('editor.help') }}</span>
        <textarea v-model="field.description" class="input textarea autosize" rows="2" maxlength="2000" :disabled="readonly" :placeholder="t('editor.helpPlaceholder')"></textarea>
      </label>
      <FieldOptions :field="field" :fields="fields" :readonly="readonly" />
      <OptionLogicEditor v-if="optionTypes.includes(field.type)" :field="field" :earlier="earlier" :readonly="readonly" />
      <RuleSetEditor v-if="field.type !== 'statement' || field.logic" :owner="field" name="logic" :variant="field.type === 'section' ? 'section' : 'display'" :earlier="earlier" :readonly="readonly" />
      <RuleSetEditor v-if="!layout && !field.required" :owner="field" name="requiredLogic" variant="required" :earlier="earlier" :readonly="readonly" />
      <p v-if="field.type === 'section'" class="hint"><AppIcon name="info" :size="14" />{{ t('editor.sectionHint') }}</p>
    </div>

    <footer v-if="active && !readonly" class="question-card-foot">
      <button v-if="!layout && !showDescription" type="button" class="text-button small" @click="showDescription = true"><AppIcon name="plus" :size="14" />{{ t('editor.addHelp') }}</button>
      <span class="spacer"></span>
      <button type="button" class="icon-button ghost" :disabled="index === 0" :title="t('editor.up')" :aria-label="t('editor.up')" @click.stop="emit('move', -1)"><AppIcon name="arrowUp" :size="16" /></button>
      <button type="button" class="icon-button ghost" :disabled="index === fields.length - 1" :title="t('editor.down')" :aria-label="t('editor.down')" @click.stop="emit('move', 1)"><AppIcon name="arrowDown" :size="16" /></button>
      <button type="button" class="icon-button ghost" :title="t('editor.duplicate')" :aria-label="t('editor.duplicate')" @click.stop="emit('duplicate')"><AppIcon name="copy" :size="16" /></button>
      <button type="button" class="icon-button ghost danger" :title="t('editor.remove')" :aria-label="t('editor.remove')" @click.stop="emit('remove')"><AppIcon name="trash" :size="16" /></button>
      <MenuButton :label="t('common.more')" button-class="icon-button ghost">
        <button type="button" class="menu-item" :disabled="index === 0" @click="emit('move', -index)"><AppIcon name="chevronUp" :size="16" />{{ t('editor.moveTop') }}</button>
        <button type="button" class="menu-item" :disabled="index === fields.length - 1" @click="emit('move', fields.length - 1 - index)"><AppIcon name="chevronDown" :size="16" />{{ t('editor.moveBottom') }}</button>
      </MenuButton>
    </footer>
  </article>
</template>
