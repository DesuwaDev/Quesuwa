<script setup>
import { computed } from 'vue';
import { t } from '../../i18n.js';
import AppIcon from '../../components/AppIcon.vue';
import { shuffled } from './shuffle.js';

// Tap items in order of preference; ranked items can then be reordered or removed.
const props = defineProps({ field: Object, state: Object, seed: String, disabled: Boolean, describedBy: String });
const ranked = computed(() => props.state.answers[props.field.id] || []);
const pool = computed(() => (props.field.shuffle ? shuffled(props.field.options, props.seed + props.field.id) : props.field.options).filter(option => !ranked.value.includes(option)));
const set = next => { props.state.answers[props.field.id] = next; };
const add = option => set([...ranked.value, option]);
const removeAt = index => set(ranked.value.filter((_, position) => position !== index));
function move(index, delta) {
  const next = [...ranked.value];
  const [item] = next.splice(index, 1);
  next.splice(index + delta, 0, item);
  set(next);
}
// Finishing with one item left is tedious; append the remainder in displayed order.
const completeRest = () => set([...ranked.value, ...pool.value]);
</script>

<template>
  <div class="ranking-answer" :aria-describedby="describedBy">
    <p class="choice-hint">{{ t('form.rankingHint', { count: field.options.length }) }}</p>
    <ol v-if="ranked.length" class="ranking-list">
      <li v-for="(option, index) in ranked" :key="option" class="ranking-item ranked">
        <span class="rank-badge">{{ index + 1 }}</span>
        <span class="ranking-text">{{ option }}</span>
        <span class="ranking-actions">
          <button type="button" class="icon-button ghost small" :disabled="disabled || index === 0" :aria-label="t('form.moveUp', { item: option })" @click="move(index, -1)"><AppIcon name="arrowUp" :size="16" /></button>
          <button type="button" class="icon-button ghost small" :disabled="disabled || index === ranked.length - 1" :aria-label="t('form.moveDown', { item: option })" @click="move(index, 1)"><AppIcon name="arrowDown" :size="16" /></button>
          <button type="button" class="icon-button ghost small" :disabled="disabled" :aria-label="t('form.unrank', { item: option })" @click="removeAt(index)"><AppIcon name="close" :size="16" /></button>
        </span>
      </li>
    </ol>
    <div v-if="pool.length" class="ranking-pool">
      <button v-for="option in pool" :key="option" type="button" class="ranking-item" :disabled="disabled" @click="add(option)">
        <span class="rank-badge empty"><AppIcon name="plus" :size="14" /></span>
        <span class="ranking-text">{{ option }}</span>
      </button>
    </div>
    <div class="scale-footer">
      <button v-if="ranked.length && pool.length && !disabled" type="button" class="text-button small" @click="completeRest">{{ t('form.rankRest') }}</button>
      <button v-if="ranked.length && !disabled" type="button" class="text-button small" @click="set([])">{{ t('form.rankReset') }}</button>
    </div>
  </div>
</template>
