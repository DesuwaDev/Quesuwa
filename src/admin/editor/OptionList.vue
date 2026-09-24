<script setup>
import { nextTick, ref } from 'vue';
import { t } from '../../i18n.js';
import { notify } from '../../lib/feedback.js';
import AppIcon from '../../components/AppIcon.vue';
import ModalFrame from '../../components/ModalFrame.vue';
import { renameOption, repairLogic } from './fields.js';

// Edits an array of option labels in place, keeping dependent display logic in sync.
const props = defineProps({ items: Array, min: { type: Number, default: 2 }, max: { type: Number, default: 50 }, fieldId: String, fields: Array, readonly: Boolean, label: String, marker: { type: String, default: 'circle' }, itemKey: { type: String, default: 'editor.optionNumber' }, maxLength: { type: Number, default: 200 } });
const root = ref(null), bulk = ref(false), bulkText = ref('');
let before = '';

const focusAt = async index => {
  await nextTick();
  root.value?.querySelectorAll('.option-input')[index]?.focus();
};

function add(index = props.items.length - 1) {
  if (props.items.length >= props.max) return;
  let number = props.items.length + 1;
  while (props.items.includes(t(props.itemKey, { number }))) number++;
  props.items.splice(index + 1, 0, t(props.itemKey, { number }));
  focusAt(index + 1);
}

function remove(index) {
  if (props.items.length <= props.min) return;
  props.items.splice(index, 1);
  const repaired = repairLogic(props.fields);
  if (repaired) notify('editor.logicRepaired', { type: 'info', params: { count: repaired } });
}

function move(index, delta) {
  const [item] = props.items.splice(index, 1);
  props.items.splice(index + delta, 0, item);
}

const remember = index => { before = props.items[index]; };

function commit(index) {
  const value = props.items[index];
  if (before && value !== before) {
    renameOption(props.fields, props.fieldId, before, value);
    repairLogic(props.fields);
  }
  before = value;
}

function keydown(event, index) {
  if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); add(index); }
  else if (event.key === 'Backspace' && !props.items[index] && props.items.length > props.min) { event.preventDefault(); remove(index); focusAt(Math.max(0, index - 1)); }
}

// Pasting several lines creates one option per line.
function paste(event, index) {
  const text = event.clipboardData?.getData('text') || '';
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return;
  event.preventDefault();
  const room = props.max - props.items.length + 1;
  const fresh = lines.filter(line => !props.items.includes(line)).slice(0, room).map(line => line.slice(0, props.maxLength));
  props.items.splice(index, 1, ...fresh);
  if (lines.length > fresh.length) notify('editor.pasteTrimmed', { type: 'info' });
}

function openBulk() {
  bulkText.value = props.items.join('\n');
  bulk.value = true;
}
function applyBulk() {
  const lines = [...new Set(bulkText.value.split(/\r?\n/).map(line => line.trim().slice(0, props.maxLength)).filter(Boolean))].slice(0, props.max);
  if (lines.length < props.min) return notify('editor.bulkTooFew', { type: 'error', params: { count: props.min } });
  props.items.splice(0, props.items.length, ...lines);
  const repaired = repairLogic(props.fields);
  if (repaired) notify('editor.logicRepaired', { type: 'info', params: { count: repaired } });
  bulk.value = false;
}
const duplicates = () => props.items.filter((item, index) => props.items.indexOf(item) !== index);
</script>

<template>
  <div ref="root" class="option-list">
    <div class="option-list-head">
      <span class="field-label">{{ label }}</span>
      <button v-if="!readonly" type="button" class="text-button small" @click="openBulk">{{ t('editor.bulkEdit') }}</button>
    </div>
    <div v-for="(_, index) in items" :key="index" class="option-row">
      <span class="option-marker" :class="marker">{{ marker === 'number' ? index + 1 : '' }}</span>
      <input
        v-model="items[index]"
        class="input option-input"
        :class="{ invalid: !items[index].trim() || duplicates().includes(items[index]) }"
        :maxlength="maxLength"
        :disabled="readonly"
        :aria-label="t(itemKey, { number: index + 1 })"
        @focus="remember(index)"
        @change="commit(index)"
        @keydown="keydown($event, index)"
        @paste="paste($event, index)"
      />
      <template v-if="!readonly">
        <button type="button" class="icon-button ghost small hide-narrow" :disabled="index === 0" :aria-label="t('editor.up')" @click="move(index, -1)"><AppIcon name="arrowUp" :size="14" /></button>
        <button type="button" class="icon-button ghost small" :disabled="items.length <= min" :aria-label="t('editor.removeOption')" @click="remove(index)"><AppIcon name="close" :size="14" /></button>
      </template>
    </div>
    <p v-if="duplicates().length" class="field-error small">{{ t('editor.duplicateOption') }}</p>
    <button v-if="!readonly && items.length < max" type="button" class="text-button small add-option" @click="add()"><AppIcon name="plus" :size="14" />{{ t('editor.addOption') }}</button>
    <p v-if="!readonly" class="hint small">{{ t('editor.optionTips') }}</p>

    <ModalFrame v-if="bulk" :title="t('editor.bulkEdit')" size="md" @close="bulk = false">
      <p class="muted small">{{ t('editor.bulkHint', { max }) }}</p>
      <textarea v-model="bulkText" class="input textarea mono" rows="10" autofocus></textarea>
      <template #actions>
        <button type="button" class="button" @click="bulk = false">{{ t('common.cancel') }}</button>
        <button type="button" class="button primary" @click="applyBulk">{{ t('common.apply') }}</button>
      </template>
    </ModalFrame>
  </div>
</template>
