<script setup>
import { formatNumber, formatPercent } from '../../lib/format.js';
import { t } from '../../i18n.js';

// Sequential single-hue cells; the text stays in ink colors for contrast.
const props = defineProps({ matrix: { type: Object, required: true } });
const rowTotal = index => props.matrix.counts[index].reduce((sum, value) => sum + value, 0);
const shade = (value, index) => {
  const total = rowTotal(index);
  return total ? Math.round((value / total) * 100) : 0;
};
</script>

<template>
  <div class="table-scroll">
    <table class="matrix-heat">
      <thead><tr><th scope="col"><span class="sr-only">{{ t('form.matrixRow') }}</span></th><th v-for="column in matrix.columns" :key="column" scope="col">{{ column }}</th></tr></thead>
      <tbody>
        <tr v-for="(row, index) in matrix.rows" :key="row">
          <th scope="row">{{ row }}</th>
          <td v-for="(value, column) in matrix.counts[index]" :key="column" :style="{ '--heat': shade(value, index) }" :title="row + ' · ' + matrix.columns[column] + ' · ' + formatNumber(value)">
            <strong>{{ formatNumber(value) }}</strong><small>{{ formatPercent(value, rowTotal(index)) }}</small>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
