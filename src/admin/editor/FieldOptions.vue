<script setup>
import { computed, watch } from 'vue';
import { t } from '../../i18n.js';
import { LIMITS, fileKinds, fileKindKeys } from '../../../shared/constants.js';
import ToggleSwitch from '../../components/ToggleSwitch.vue';
import OptionList from './OptionList.vue';

const props = defineProps({ field: Object, fields: Array, readonly: Boolean });
const type = computed(() => props.field.type);
const textLimit = computed(() => type.value === 'long' ? LIMITS.longText : LIMITS.shortText);
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

// Keep selection limits consistent when options are removed or limits change.
watch(() => [props.field.minSelect, props.field.maxSelect, props.field.options.length], ([min, max, count]) => {
  if (props.field.type !== 'multi') return;
  if (min > count) props.field.minSelect = count;
  if (max > count) props.field.maxSelect = count;
  if (props.field.maxSelect && props.field.minSelect > props.field.maxSelect) props.field.maxSelect = props.field.minSelect;
});

function toggleKind(kind, checked) {
  const next = checked ? [...new Set([...props.field.fileKinds, kind])] : props.field.fileKinds.filter(item => item !== kind);
  if (next.length) props.field.fileKinds = fileKinds.filter(item => next.includes(item));
}
</script>

<template>
  <div class="field-options">
    <template v-if="['single', 'multi', 'select', 'ranking'].includes(type)">
      <OptionList :items="field.options" :field-id="field.id" :fields="fields" :readonly="readonly" :label="t('labels.options')" :max="type === 'ranking' ? LIMITS.rankingOptions : LIMITS.options" :marker="type === 'multi' ? 'square' : type === 'ranking' || type === 'select' ? 'number' : 'circle'" />
      <div class="option-toggles">
        <ToggleSwitch v-if="type === 'single' || type === 'multi'" v-model="field.allowOther" :label="t('editor.allowOther')" :hint="t('editor.allowOtherHint')" :disabled="readonly" />
        <ToggleSwitch v-model="field.shuffle" :label="t('editor.shuffle')" :hint="t('editor.shuffleHint')" :disabled="readonly" />
      </div>
      <div v-if="type === 'multi'" class="inline-fields">
        <label class="field">
          <span class="field-label">{{ t('editor.minSelect') }}</span>
          <select v-model.number="field.minSelect" class="input select" :disabled="readonly">
            <option :value="0">{{ t('editor.noLimit') }}</option>
            <option v-for="count in range(1, field.options.length)" :key="count" :value="count">{{ count }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">{{ t('editor.maxSelect') }}</span>
          <select v-model.number="field.maxSelect" class="input select" :disabled="readonly">
            <option :value="0">{{ t('editor.noLimit') }}</option>
            <option v-for="count in range(Math.max(1, field.minSelect || 1), field.options.length)" :key="count" :value="count">{{ count }}</option>
          </select>
        </label>
      </div>
    </template>

    <div v-else-if="type === 'matrix'" class="matrix-editor">
      <OptionList :items="field.rows" :min="1" :max="LIMITS.matrixRows" :field-id="field.id" :fields="fields" :readonly="readonly" :label="t('editor.matrixRows')" marker="number" item-key="editor.rowNumber" />
      <OptionList :items="field.columns" :min="2" :max="LIMITS.matrixColumns" :field-id="field.id" :fields="fields" :readonly="readonly" :label="t('editor.matrixColumns')" marker="circle" item-key="editor.columnNumber" :max-length="100" />
    </div>

    <div v-else-if="type === 'rating'" class="inline-fields">
      <label class="field">
        <span class="field-label">{{ t('settings.ratingMax') }}</span>
        <select v-model.number="field.ratingMax" class="input select" :disabled="readonly"><option v-for="count in range(3, 10)" :key="count" :value="count">{{ count }}</option></select>
      </label>
    </div>

    <template v-else-if="type === 'scale' || type === 'nps'">
      <div v-if="type === 'scale'" class="inline-fields">
        <label class="field">
          <span class="field-label">{{ t('editor.scaleFrom') }}</span>
          <select v-model.number="field.scaleMin" class="input select" :disabled="readonly"><option :value="0">0</option><option :value="1">1</option></select>
        </label>
        <label class="field">
          <span class="field-label">{{ t('editor.scaleTo') }}</span>
          <select v-model.number="field.scaleMax" class="input select" :disabled="readonly"><option v-for="count in range(2, 10)" :key="count" :value="count">{{ count }}</option></select>
        </label>
      </div>
      <div class="inline-fields">
        <label class="field">
          <span class="field-label">{{ t('editor.minLabel') }}</span>
          <input v-model="field.minLabel" class="input" maxlength="40" :disabled="readonly" :placeholder="type === 'nps' ? t('form.npsLow') : t('editor.minLabelPlaceholder')" />
        </label>
        <label class="field">
          <span class="field-label">{{ t('editor.maxLabel') }}</span>
          <input v-model="field.maxLabel" class="input" maxlength="40" :disabled="readonly" :placeholder="type === 'nps' ? t('form.npsHigh') : t('editor.maxLabelPlaceholder')" />
        </label>
      </div>
    </template>

    <template v-else-if="['short', 'long', 'email', 'phone', 'url', 'number'].includes(type)">
      <label class="field">
        <span class="field-label">{{ t('settings.placeholder') }}</span>
        <input v-model="field.placeholder" class="input" maxlength="200" :disabled="readonly" :placeholder="t('editor.placeholderHint')" />
      </label>
      <div v-if="type === 'short' || type === 'long'" class="inline-fields">
        <label class="field">
          <span class="field-label">{{ t('editor.minLength') }}</span>
          <input v-model.number="field.minLength" class="input" type="number" min="0" :max="textLimit" :disabled="readonly" />
        </label>
        <label class="field">
          <span class="field-label">{{ t('settings.maxLength') }}</span>
          <input v-model.number="field.maxLength" class="input" type="number" min="1" :max="textLimit" :disabled="readonly" />
        </label>
      </div>
      <template v-if="type === 'number'">
        <div class="inline-fields">
          <label class="field">
            <span class="field-label">{{ t('settings.min') }}</span>
            <input v-model.number="field.min" class="input" type="number" step="any" :disabled="readonly" :placeholder="t('editor.noLimit')" />
          </label>
          <label class="field">
            <span class="field-label">{{ t('settings.max') }}</span>
            <input v-model.number="field.max" class="input" type="number" step="any" :disabled="readonly" :placeholder="t('editor.noLimit')" />
          </label>
        </div>
        <ToggleSwitch v-model="field.integer" :label="t('editor.integerOnly')" :disabled="readonly" />
      </template>
    </template>

    <template v-else-if="type === 'file'">
      <div class="inline-fields">
        <label class="field">
          <span class="field-label">{{ t('settings.maxFiles') }}</span>
          <select v-model.number="field.maxFiles" class="input select" :disabled="readonly"><option v-for="count in range(1, LIMITS.filesPerField)" :key="count" :value="count">{{ count }}</option></select>
        </label>
        <label class="field">
          <span class="field-label">{{ t('settings.maxFileMB') }}</span>
          <select v-model.number="field.maxFileMB" class="input select" :disabled="readonly"><option v-for="size in [1, 2, 5, 10]" :key="size" :value="size">{{ t('size.mb', { value: size }) }}</option></select>
        </label>
      </div>
      <div class="field">
        <span class="field-label">{{ t('settings.fileKinds') }}</span>
        <div class="check-group">
          <label v-for="kind in fileKinds" :key="kind" class="check-row"><input type="checkbox" :checked="field.fileKinds.includes(kind)" :disabled="readonly || (field.fileKinds.length === 1 && field.fileKinds.includes(kind))" @change="toggleKind(kind, $event.target.checked)" />{{ t(fileKindKeys[kind]) }}</label>
        </div>
      </div>
      <p class="hint small">{{ t('editor.fileHint') }}</p>
    </template>
  </div>
</template>
