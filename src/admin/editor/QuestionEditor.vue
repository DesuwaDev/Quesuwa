<script setup>
import { computed, nextTick, ref } from 'vue';
import { t } from '../../i18n.js';
import { notify } from '../../lib/feedback.js';
import { LIMITS, fieldTypes } from '../../../shared/constants.js';
import { answerable } from '../../../shared/schema.js';
import AppIcon from '../../components/AppIcon.vue';
import ModalFrame from '../../components/ModalFrame.vue';
import QuestionCard from './QuestionCard.vue';
import TypePalette from './TypePalette.vue';
import { fieldIcons } from '../../components/icons.js';
import { newField, cloneField, repairLogic, hasLogic } from './fields.js';

const props = defineProps({ draft: { type: Object, required: true }, readonly: Boolean });
const active = ref(props.draft.fields[0]?.id || null);
const paletteOpen = ref(false);
const dragFrom = ref(-1), dragOver = ref(-1);
const list = ref(null);

const fields = computed(() => props.draft.fields);
const numbers = computed(() => {
  let count = 0;
  return Object.fromEntries(fields.value.map(field => [field.id, answerable(field) ? ++count : 0]));
});
const pageCount = computed(() => 1 + fields.value.filter((field, index) => field.type === 'section' && index > 0).length);
const stats = computed(() => ({ questions: fields.value.filter(answerable).length, required: fields.value.filter(field => field.required).length, pages: pageCount.value }));
const disabledTypes = computed(() => {
  const full = fields.value.length >= LIMITS.fields;
  return Object.keys(fieldTypes).filter(type => full || (type === 'file' && fields.value.filter(field => field.type === 'file').length >= LIMITS.fileFields));
});

async function reveal(id) {
  active.value = id;
  await nextTick();
  const element = list.value?.querySelector(`[data-question="${CSS.escape(id)}"]`);
  element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element?.querySelector('.question-label-input')?.focus({ preventScroll: true });
}

function add(type) {
  paletteOpen.value = false;
  if (disabledTypes.value.includes(type)) return;
  const field = newField(type);
  const index = fields.value.findIndex(item => item.id === active.value);
  fields.value.splice(index >= 0 ? index + 1 : fields.value.length, 0, field);
  reveal(field.id);
}

function duplicate(index) {
  const source = fields.value[index];
  if (fields.value.length >= LIMITS.fields || (source.type === 'file' && disabledTypes.value.includes('file'))) return notify('editor.limitReached', { type: 'error' });
  const copy = cloneField(source);
  fields.value.splice(index + 1, 0, copy);
  reveal(copy.id);
}

function remove(index) {
  const [field] = fields.value.splice(index, 1);
  const snapshot = structuredClone(fields.value.map(item => item.logic));
  const repaired = repairLogic(fields.value);
  active.value = fields.value[Math.min(index, fields.value.length - 1)]?.id || null;
  notify(repaired ? 'editor.removedWithLogic' : 'editor.removed', {
    params: { count: repaired },
    action: {
      key: 'common.undo',
      run: () => {
        fields.value.forEach((item, position) => { item.logic = snapshot[position]; });
        fields.value.splice(index, 0, field);
        reveal(field.id);
      }
    },
    timeout: 6000
  });
}

function move(from, to) {
  if (to < 0 || to >= fields.value.length || from === to) return;
  const [field] = fields.value.splice(from, 1);
  fields.value.splice(to, 0, field);
  const repaired = repairLogic(fields.value);
  if (repaired) notify('editor.logicRepaired', { type: 'info', params: { count: repaired } });
}

// Drag and drop reordering (pointer devices); buttons cover touch and keyboard.
function dragStart(index, event) {
  dragFrom.value = index;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(index));
}
function dragEnter(index) { if (dragFrom.value >= 0) dragOver.value = index; }
function drop(index) {
  if (dragFrom.value >= 0) move(dragFrom.value, index);
  dragFrom.value = -1;
  dragOver.value = -1;
}
function dragEnd() { dragFrom.value = -1; dragOver.value = -1; }

function focusIndex(index) {
  const field = fields.value[index];
  if (field) reveal(field.id);
}
defineExpose({ focusIndex });
</script>

<template>
  <div class="editor-layout">
    <div ref="list" class="editor-canvas">
      <section class="card form-header-editor">
        <label class="field">
          <span class="field-label">{{ t('labels.title') }}</span>
          <input v-model="draft.title" class="input title-input" maxlength="120" :disabled="readonly" :placeholder="t('common.untitled')" />
        </label>
        <label class="field">
          <span class="field-label">{{ t('labels.description') }}</span>
          <textarea v-model="draft.description" class="input textarea autosize" rows="2" maxlength="3000" :disabled="readonly" :placeholder="t('editor.descriptionPlaceholder')"></textarea>
        </label>
      </section>

      <div v-if="!fields.length" class="empty-canvas">
        <AppIcon name="plus" :size="26" />
        <h2>{{ t('editor.firstQuestion') }}</h2>
        <p>{{ t('editor.firstHint') }}</p>
        <TypePalette v-if="!readonly" :disabled="disabledTypes" inline @pick="add" />
      </div>

      <TransitionGroup name="list" tag="div" class="question-stack">
        <QuestionCard
          v-for="(field, index) in fields"
          :key="field.id"
          :field="field"
          :fields="fields"
          :index="index"
          :number="numbers[field.id]"
          :active="active === field.id"
          :readonly="readonly"
          :class="{ 'drag-over': dragOver === index && dragFrom !== index, dragging: dragFrom === index }"
          :data-question="field.id"
          @activate="active = field.id"
          @move="move(index, index + $event)"
          @duplicate="duplicate(index)"
          @remove="remove(index)"
          @dragstart-handle="dragStart(index, $event)"
          @dragenter.prevent="dragEnter(index)"
          @dragover.prevent
          @drop.prevent="drop(index)"
          @dragend="dragEnd"
        />
      </TransitionGroup>

      <button v-if="!readonly && fields.length" type="button" class="add-question" :disabled="fields.length >= LIMITS.fields" @click="paletteOpen = true">
        <AppIcon name="plus" :size="18" />{{ t('editor.add') }}
      </button>
    </div>

    <aside class="editor-aside">
      <section v-if="!readonly" class="card">
        <h3 class="card-title">{{ t('editor.add') }}</h3>
        <TypePalette :disabled="disabledTypes" compact @pick="add" />
      </section>
      <section class="card outline-card">
        <h3 class="card-title">{{ t('editor.outline') }}</h3>
        <p class="muted small">{{ t('editor.outlineStats', stats) }}</p>
        <ol class="outline">
          <li v-for="field in fields" :key="field.id" :class="{ active: active === field.id, section: field.type === 'section' }">
            <button type="button" @click="reveal(field.id)">
              <AppIcon :name="fieldIcons[field.type]" :size="14" />
              <span class="outline-number">{{ numbers[field.id] || '' }}</span>
              <span class="clamp-1">{{ field.label }}</span>
              <AppIcon v-if="hasLogic(field)" name="branch" :size="12" class="outline-flag" />
            </button>
          </li>
        </ol>
      </section>
    </aside>

    <ModalFrame v-if="paletteOpen" :title="t('editor.add')" size="md" @close="paletteOpen = false">
      <TypePalette :disabled="disabledTypes" @pick="add" />
    </ModalFrame>
  </div>
</template>
