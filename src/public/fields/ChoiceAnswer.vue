<script setup>
import { computed, nextTick, ref } from 'vue';
import { t } from '../../i18n.js';
import { shuffled } from './shuffle.js';

const props = defineProps({ field: Object, state: Object, seed: String, disabled: Boolean, describedBy: String });
const multi = computed(() => props.field.type === 'multi');
const options = computed(() => props.field.shuffle ? shuffled(props.field.options, props.seed + props.field.id) : props.field.options);
// The questionnaire creates one "other" record per question that allows it.
const other = computed(() => props.state.others[props.field.id] || { selected: false, text: '' });
const selected = computed(() => props.state.answers[props.field.id] ?? (multi.value ? [] : ''));
const otherInput = ref(null);
const selectionCount = computed(() => (multi.value ? selected.value.length : 0) + (other.value.selected ? 1 : 0));
const atMax = computed(() => multi.value && props.field.maxSelect > 0 && selectionCount.value >= props.field.maxSelect);
const hint = computed(() => {
  if (!multi.value) return '';
  const { minSelect, maxSelect } = props.field;
  if (minSelect && maxSelect) return minSelect === maxSelect ? t('form.selectExactly', { count: minSelect }) : t('form.selectBetween', { min: minSelect, max: maxSelect });
  if (minSelect) return t('form.selectAtLeast', { count: minSelect });
  if (maxSelect) return t('form.selectAtMost', { count: maxSelect });
  return t('form.selectAny');
});

const isChecked = option => multi.value ? selected.value.includes(option) : !other.value.selected && selected.value === option;

function choose(option, checked) {
  if (multi.value) {
    const current = selected.value.filter(item => item !== option);
    props.state.answers[props.field.id] = checked ? props.field.options.filter(item => current.includes(item) || item === option) : current;
  } else {
    props.state.answers[props.field.id] = option;
    other.value.selected = false;
  }
}

async function chooseOther(checked) {
  other.value.selected = checked;
  if (!multi.value && checked) props.state.answers[props.field.id] = '';
  if (checked) { await nextTick(); otherInput.value?.focus(); }
}

// Radio groups can be cleared when the question is optional.
function clear() {
  props.state.answers[props.field.id] = multi.value ? [] : '';
  other.value.selected = false;
}
</script>

<template>
  <div class="choice-answer" role="group" :aria-describedby="describedBy">
    <p v-if="hint" class="choice-hint">{{ hint }}</p>
    <div class="choice-list" :class="{ columns: options.length > 6 }">
      <label v-for="option in options" :key="option" class="choice-option" :class="{ checked: isChecked(option), disabled: disabled || (atMax && !isChecked(option)) }">
        <input
          :type="multi ? 'checkbox' : 'radio'"
          :name="'q-' + field.id"
          :value="option"
          :checked="isChecked(option)"
          :disabled="disabled || (atMax && !isChecked(option))"
          @change="choose(option, $event.target.checked)"
        />
        <span class="choice-control" aria-hidden="true"></span>
        <span class="choice-text">{{ option }}</span>
      </label>
      <label v-if="field.allowOther" class="choice-option other" :class="{ checked: other.selected, disabled: disabled || (atMax && !other.selected) }">
        <input
          :type="multi ? 'checkbox' : 'radio'"
          :name="'q-' + field.id"
          :checked="other.selected"
          :disabled="disabled || (atMax && !other.selected)"
          @change="chooseOther($event.target.checked)"
        />
        <span class="choice-control" aria-hidden="true"></span>
        <span class="choice-text">{{ t('form.other') }}</span>
        <input
          v-if="other.selected"
          ref="otherInput"
          v-model="other.text"
          class="input other-input"
          maxlength="200"
          :placeholder="t('form.otherPlaceholder')"
          :aria-label="t('form.otherPlaceholder')"
          :disabled="disabled"
          @click.stop
        />
      </label>
    </div>
    <button v-if="!multi && !field.required && (selected || other.selected) && !disabled" type="button" class="text-button small" @click="clear">{{ t('form.clearChoice') }}</button>
  </div>
</template>
