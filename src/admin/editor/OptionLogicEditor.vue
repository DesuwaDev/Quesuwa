<script setup>
import { computed } from 'vue';
import { t } from '../../i18n.js';
import { answerable } from '../../../shared/schema.js';
import AppIcon from '../../components/AppIcon.vue';
import RuleSetEditor from './RuleSetEditor.vue';

// Per-option conditions: an option is only offered when its conditions are met.
const props = defineProps({ field: Object, earlier: Array, readonly: Boolean });
const entries = computed(() => props.field.optionLogic || []);
const available = computed(() => props.field.options.filter(option => option.trim() && !entries.value.some(entry => entry.option === option)));
const hasCandidates = computed(() => props.earlier.some(answerable));

function add(option) {
  if (!option) return;
  if (!Array.isArray(props.field.optionLogic)) props.field.optionLogic = [];
  props.field.optionLogic.push({ option, logic: null });
}
function remove(entry) {
  props.field.optionLogic = entries.value.filter(item => item !== entry);
}
</script>

<template>
  <section v-if="hasCandidates || entries.length" class="option-logic">
    <div class="option-logic-head">
      <span class="field-label"><AppIcon name="filter" :size="14" />{{ t('logic.optionSection') }}</span>
      <select v-if="!readonly && available.length" class="input select compact" :value="''" :aria-label="t('logic.addOption')" @change="add($event.target.value); $event.target.value = ''">
        <option value="" disabled>{{ t('logic.addOption') }}</option>
        <option v-for="option in available" :key="option" :value="option">{{ option }}</option>
      </select>
    </div>
    <p v-if="!entries.length" class="hint small">{{ t('logic.optionEmpty') }}</p>
    <RuleSetEditor v-for="entry in entries" :key="entry.option" :owner="entry" name="logic" variant="option" :option="entry.option" :earlier="earlier" :readonly="readonly" auto-enable @cleared="remove(entry)" />
  </section>
</template>
