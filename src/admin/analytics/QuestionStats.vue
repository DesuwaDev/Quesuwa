<script setup>
import { computed } from 'vue';
import { t } from '../../i18n.js';
import { linkHandler } from '../../lib/router.js';
import { formatNumber, formatPercent, relativeTime } from '../../lib/format.js';
import { fieldTypes } from '../../../shared/constants.js';
import { fieldIcons } from '../../components/icons.js';
import AppIcon from '../../components/AppIcon.vue';
import BarList from '../../components/charts/BarList.vue';
import ColumnChart from '../../components/charts/ColumnChart.vue';
import NpsBar from '../../components/charts/NpsBar.vue';
import MatrixHeat from '../../components/charts/MatrixHeat.vue';

const props = defineProps({ field: Object, index: Number, formId: String });
const choice = computed(() => ['single', 'select', 'multi'].includes(props.field.type));
const options = computed(() => [
  ...(props.field.options || []).map(item => ({ label: item.label, count: item.count })),
  ...(props.field.other ? [{ label: t('stats.otherAnswers'), count: props.field.other, muted: true }] : [])
]);
const distribution = computed(() => (props.field.distribution || []).map(item => ({ label: String(item.value), value: item.count, detail: t('stats.scoreLabel', { value: item.value }) })));
const rankingMax = computed(() => Math.max(1, ...(props.field.ranking || []).map(item => item.average)));
const link = id => '/admin/forms/' + props.formId + '/responses?r=' + id;
</script>

<template>
  <article class="card question-stat" :class="{ wide: field.type === 'matrix' }">
    <header class="question-stat-head">
      <span class="question-index"><AppIcon :name="fieldIcons[field.type]" :size="14" />{{ index }}</span>
      <div>
        <h3>{{ field.label }}</h3>
        <p class="muted small">
          {{ t(fieldTypes[field.type]) }} · {{ t('stats.answeredOf', { answered: formatNumber(field.answered), reach: formatNumber(field.reach) }) }}
          <span v-if="field.reach">({{ formatPercent(field.answered, field.reach) }})</span>
        </p>
        <p v-if="field.relabeled" class="hint small"><AppIcon name="info" :size="12" />{{ t('stats.relabeled') }}</p>
      </div>
    </header>

    <p v-if="!field.answered" class="muted small">{{ t('stats.noAnswers') }}</p>
    <template v-else-if="choice">
      <BarList :items="options" :total="field.answered" />
      <p v-if="field.type === 'multi'" class="hint small">{{ t('stats.multiHint') }}</p>
      <details v-if="field.otherSamples?.length" class="samples-disclosure">
        <summary>{{ t('stats.otherSamples', { count: field.otherSamples.length }) }}</summary>
        <ul class="sample-list"><li v-for="(sample, position) in field.otherSamples" :key="position">{{ sample }}</li></ul>
      </details>
    </template>
    <template v-else-if="field.numeric">
      <dl class="numeric-summary">
        <div><dt>{{ t('stats.average') }}</dt><dd>{{ formatNumber(field.numeric.avg) }}</dd></div>
        <div><dt>{{ t('stats.median') }}</dt><dd>{{ formatNumber(field.numeric.median) }}</dd></div>
        <div><dt>{{ t('stats.min') }}</dt><dd>{{ formatNumber(field.numeric.min) }}</dd></div>
        <div><dt>{{ t('stats.max') }}</dt><dd>{{ formatNumber(field.numeric.max) }}</dd></div>
      </dl>
      <NpsBar v-if="field.nps" :nps="field.nps" />
      <ColumnChart v-if="distribution.length" :items="distribution" :height="160" :label-every="1" :caption="field.label" />
    </template>
    <MatrixHeat v-else-if="field.matrix" :matrix="field.matrix" />
    <template v-else-if="field.ranking">
    <ol class="ranking-stats">
      <li v-for="(item, position) in field.ranking" :key="item.label">
        <span class="rank-index">{{ position + 1 }}</span>
        <span class="ranking-stat-label">{{ item.label }}</span>
        <span class="bar-track" aria-hidden="true"><span class="bar-fill" :style="{ width: ((rankingMax - item.average + 1) / rankingMax) * 100 + '%' }"></span></span>
        <strong :title="t('stats.averageRank')">{{ formatNumber(item.average) }}</strong>
      </li>
    </ol>
    <p class="hint small">{{ t('stats.rankingHint') }}</p>
    </template>
    <dl v-else-if="field.files" class="numeric-summary">
      <div><dt>{{ t('stats.fileResponses') }}</dt><dd>{{ formatNumber(field.files.responses) }}</dd></div>
      <div><dt>{{ t('stats.fileCount') }}</dt><dd>{{ formatNumber(field.files.files) }}</dd></div>
    </dl>
    <template v-else-if="field.samples">
      <p class="field-label">{{ t('stats.latestAnswers') }}</p>
      <ul class="sample-list">
        <li v-for="sample in field.samples" :key="sample.responseId">
          <a :href="link(sample.responseId)" @click="linkHandler(link(sample.responseId))($event)"><span class="clamp-3 preserve">{{ sample.value }}</span><time class="muted small">{{ relativeTime(sample.createdAt) }}</time></a>
        </li>
      </ul>
    </template>
  </article>
</template>
