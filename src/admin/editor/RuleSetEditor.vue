<script setup>
import { computed, onMounted } from 'vue';
import { t } from '../../i18n.js';
import { logicOperators, LIMITS } from '../../../shared/constants.js';
import { answerable, operatorsFor, operatorUsesOption, operatorNeedsValue } from '../../../shared/schema.js';
import AppIcon from '../../components/AppIcon.vue';

// Edits one rule set stored at owner[name]: display logic, conditional required or an option condition.
const props = defineProps({ owner: Object, name: { type: String, default: 'logic' }, earlier: Array, readonly: Boolean, variant: { type: String, default: 'display' }, option: String, autoEnable: Boolean });
const emit = defineEmits(['cleared']);
const texts = {
  display: { title: 'logic.title', add: 'logic.add', hint: 'logic.hint', icon: 'branch' },
  section: { title: 'logic.sectionTitle', add: 'logic.addSection', hint: 'logic.sectionHint', icon: 'branch' },
  required: { title: 'logic.requiredTitle', add: 'logic.addRequired', hint: 'logic.requiredHint', icon: 'alert' },
  option: { title: 'logic.optionTitle', add: 'logic.add', hint: 'logic.optionHint', icon: 'filter' }
};
const text = computed(() => texts[props.variant] || texts.display);
const logic = computed(() => props.owner[props.name]);
const candidates = computed(() => props.earlier.filter(field => answerable(field)));
const numberOf = id => candidates.value.findIndex(field => field.id === id) + 1;
const parentOf = rule => props.earlier.find(field => field.id === rule.fieldId);

function defaultRule(parent) {
  const op = parent.type === 'nps' ? 'gte' : operatorsFor(parent.type)[0];
  return { fieldId: parent.id, op, value: operatorUsesOption(op) ? parent.options[0] : operatorNeedsValue(op) ? numericDefault(parent) : '' };
}

// A sensible starting threshold so a new numeric rule is valid immediately.
function numericDefault(parent) {
  if (parent.type === 'nps') return '9';
  if (parent.type === 'rating') return String(parent.ratingMax || 5);
  if (parent.type === 'scale') return String(parent.scaleMax || 5);
  return String(parent.min ?? 0);
}

function enable() {
  if (!candidates.value.length) return;
  props.owner[props.name] = { match: 'all', rules: [defaultRule(candidates.value.at(-1))] };
}
function clear() {
  props.owner[props.name] = null;
  emit('cleared');
}
onMounted(() => { if (props.autoEnable && !logic.value) enable(); });

function addRule() {
  if (logic.value.rules.length >= LIMITS.logicRules) return;
  logic.value.rules.push(defaultRule(candidates.value.at(-1)));
}
function removeRule(index) {
  logic.value.rules.splice(index, 1);
  if (!logic.value.rules.length) clear();
}
function setParent(rule, id) {
  const parent = props.earlier.find(field => field.id === id);
  if (parent) Object.assign(rule, defaultRule(parent));
}
function setOperator(rule, op) {
  const parent = parentOf(rule);
  rule.op = op;
  if (operatorUsesOption(op)) { if (!parent.options.includes(rule.value)) rule.value = parent.options[0]; }
  else if (operatorNeedsValue(op)) { if (rule.value === '' || !Number.isFinite(Number(rule.value))) rule.value = numericDefault(parent); }
  else rule.value = '';
}
</script>

<template>
  <section class="logic-editor" :class="['logic-' + variant, { enabled: logic }]">
    <div v-if="!logic" class="logic-empty">
      <button v-if="!readonly" type="button" class="text-button small" :disabled="!candidates.length" @click="enable"><AppIcon :name="text.icon" :size="14" />{{ t(text.add) }}</button>
      <span v-if="!candidates.length" class="muted small">{{ t('logic.noCandidates') }}</span>
    </div>
    <template v-else>
      <header class="logic-head">
        <AppIcon :name="text.icon" :size="16" />
        <strong>{{ variant === 'option' ? t('logic.optionTitle', { option }) : t(text.title) }}</strong>
        <select v-if="logic.rules.length > 1" v-model="logic.match" class="input select compact" :disabled="readonly" :aria-label="t('logic.match')">
          <option value="all">{{ t('logic.matchAll') }}</option>
          <option value="any">{{ t('logic.matchAny') }}</option>
        </select>
      </header>
      <div v-for="(rule, index) in logic.rules" :key="index" class="logic-rule">
        <span class="logic-joiner">{{ index === 0 ? t('logic.when') : logic.match === 'any' ? t('logic.or') : t('logic.and') }}</span>
        <select class="input select" :value="rule.fieldId" :disabled="readonly" :aria-label="t('logic.question')" @change="setParent(rule, $event.target.value)">
          <option v-if="!parentOf(rule)" :value="rule.fieldId" disabled>{{ t('logic.missing') }}</option>
          <option v-for="candidate in candidates" :key="candidate.id" :value="candidate.id">{{ numberOf(candidate.id) }}. {{ candidate.label }}</option>
        </select>
        <template v-if="parentOf(rule)">
          <select class="input select" :value="rule.op" :disabled="readonly" :aria-label="t('logic.operator')" @change="setOperator(rule, $event.target.value)">
            <option v-for="op in operatorsFor(parentOf(rule).type)" :key="op" :value="op">{{ t(logicOperators[op]) }}</option>
          </select>
          <select v-if="operatorUsesOption(rule.op)" v-model="rule.value" class="input select" :disabled="readonly" :aria-label="t('logic.value')">
            <option v-for="choice in parentOf(rule).options" :key="choice" :value="choice">{{ choice }}</option>
          </select>
          <input v-else-if="operatorNeedsValue(rule.op)" v-model="rule.value" class="input" type="number" step="any" :disabled="readonly" :aria-label="t('logic.value')" :placeholder="t('logic.numberPlaceholder')" />
        </template>
        <button v-if="!readonly" type="button" class="icon-button ghost small" :aria-label="t('logic.removeRule')" @click="removeRule(index)"><AppIcon name="close" :size="14" /></button>
      </div>
      <div v-if="!readonly" class="logic-foot">
        <button type="button" class="text-button small" :disabled="logic.rules.length >= LIMITS.logicRules" @click="addRule"><AppIcon name="plus" :size="14" />{{ t('logic.addRule') }}</button>
        <button type="button" class="text-button small danger" @click="clear">{{ t('logic.clear') }}</button>
      </div>
      <p class="hint small">{{ t(text.hint) }}</p>
    </template>
  </section>
</template>
