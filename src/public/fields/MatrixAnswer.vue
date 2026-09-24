<script setup>
import { t } from '../../i18n.js';

// A table on wide screens; each row becomes a card with option chips on phones (CSS).
const props = defineProps({ field: Object, state: Object, disabled: Boolean, describedBy: String });
const value = rowIndex => props.state.answers[props.field.id]?.[rowIndex] || '';
function set(rowIndex, column) {
  const next = props.field.rows.map((_, index) => value(index));
  next[rowIndex] = column;
  props.state.answers[props.field.id] = next;
}
</script>

<template>
  <div class="matrix-answer" :aria-describedby="describedBy">
    <table class="matrix-table">
      <thead>
        <tr><th scope="col"><span class="sr-only">{{ t('form.matrixRow') }}</span></th><th v-for="column in field.columns" :key="column" scope="col">{{ column }}</th></tr>
      </thead>
      <tbody>
        <tr v-for="(row, rowIndex) in field.rows" :key="row" :class="{ answered: value(rowIndex) }">
          <th scope="row">{{ row }}</th>
          <td v-for="column in field.columns" :key="column" :data-label="column">
            <label class="matrix-cell" :class="{ checked: value(rowIndex) === column }">
              <input type="radio" :name="'q-' + field.id + '-' + rowIndex" :value="column" :checked="value(rowIndex) === column" :disabled="disabled" :aria-label="row + ' · ' + column" @change="set(rowIndex, column)" />
              <span class="choice-control" aria-hidden="true"></span>
              <span class="matrix-chip-label">{{ column }}</span>
            </label>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
