<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t, locale } from '../../i18n.js';
import { api, allowed, query } from '../../lib/api.js';
import { route, updateQuery } from '../../lib/router.js';
import { confirmDialog, promptDialog, notify, notifyError } from '../../lib/feedback.js';
import { relativeTime, formatDate, shortId, formatNumber } from '../../lib/format.js';
import { statuses, statusKeys } from '../../../shared/constants.js';
import AppIcon from '../../components/AppIcon.vue';
import EmptyState from '../../components/EmptyState.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import MenuButton from '../../components/MenuButton.vue';
import PaginationBar from '../../components/PaginationBar.vue';
import DateRange from '../../components/DateRange.vue';
import ResponseDetail from './ResponseDetail.vue';
import { summarizeResponse } from './format.js';

const props = defineProps({ form: { type: Object, required: true } });
const emit = defineEmits(['count']);
const items = ref([]), total = ref(0), loading = ref(false), busy = ref(false);
const filters = ref({ q: '', status: '', starred: false, trash: false, sort: 'newest', from: '', to: '' });
const page = ref(1), pageSize = ref(20);
const selected = ref([]);
const detailId = computed(() => route.query.r || '');
const writable = computed(() => allowed('responses.write'));
let controller = null, searchTimer = null;

const params = computed(() => ({ q: filters.value.q.trim(), status: filters.value.status, starred: filters.value.starred ? 'true' : '', from: filters.value.from, to: filters.value.to }));
const exportQuery = format => query({ ...params.value, format, lang: locale.value });
const activeFilters = computed(() => Boolean(params.value.q || params.value.status || params.value.starred || params.value.from || params.value.to));

async function load() {
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  try {
    const data = await api('/admin/forms/' + props.form.id + '/responses' + query({ ...params.value, trash: filters.value.trash ? 'true' : '', sort: filters.value.sort, page: page.value, pageSize: pageSize.value }), { signal: controller.signal });
    items.value = data.items;
    total.value = data.total;
    selected.value = selected.value.filter(id => data.items.some(item => item.id === id));
    if (!filters.value.trash && !activeFilters.value) emit('count', data.total);
    if (!data.items.length && page.value > 1) { page.value -= 1; return load(); }
  } catch (error) {
    if (error.name !== 'AbortError') notifyError(error);
  } finally { loading.value = false; }
}

watch(() => [filters.value.status, filters.value.starred, filters.value.trash, filters.value.sort, filters.value.from, filters.value.to, pageSize.value], () => { page.value = 1; selected.value = []; load(); });
watch(() => filters.value.q, () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page.value = 1; load(); }, 300); });
watch(page, load);
onMounted(load);
onBeforeUnmount(() => { controller?.abort(); clearTimeout(searchTimer); });

const allSelected = computed(() => items.value.length > 0 && items.value.every(item => selected.value.includes(item.id)));
const toggleAll = checked => { selected.value = checked ? items.value.map(item => item.id) : []; };
const open = id => updateQuery({ r: id }, { replace: false });
const close = () => updateQuery({ r: '' });
const index = computed(() => items.value.findIndex(item => item.id === detailId.value));

async function batch(action, extra = {}) {
  const ids = [...selected.value];
  if (!ids.length) return;
  if (action === 'trash' && !(await confirmDialog({ titleKey: 'responses.trashTitle', messageKey: 'responses.trashConfirm', params: { count: ids.length }, danger: true, confirmKey: 'responses.trash' }))) return;
  let confirmation;
  if (action === 'purge') {
    confirmation = await promptDialog({ titleKey: 'responses.purgeTitle', messageKey: 'responses.purgeConfirm', params: { count: ids.length, title: props.form.title }, expected: props.form.title, danger: true, confirmKey: 'responses.purge' });
    if (confirmation !== props.form.title) return;
  }
  busy.value = true;
  try {
    const result = await api('/admin/forms/' + props.form.id + '/responses/batch', { method: 'POST', body: { ids, action, confirmation, ...extra } });
    notify('responses.batchDone', { params: { count: result.count } });
    selected.value = [];
    if (['trash', 'restore', 'purge'].includes(action) && ids.includes(detailId.value)) close();
    await load();
  } catch (error) { notifyError(error); }
  finally { busy.value = false; }
}

async function toggleStar(item) {
  if (!writable.value || filters.value.trash) return;
  try {
    const updated = await api('/admin/responses/' + item.id, { method: 'PATCH', body: { starred: !item.starred } });
    item.starred = updated.starred;
  } catch (error) { notifyError(error); }
}

function updated(response) {
  const target = items.value.find(item => item.id === response.id);
  if (target) Object.assign(target, response);
}
function removed() { close(); load(); }
function resetFilters() { filters.value = { ...filters.value, q: '', status: '', starred: false, from: '', to: '' }; }
</script>

<template>
  <div class="responses-view" :class="{ 'has-detail': detailId }">
    <div class="toolbar">
      <label class="search-input grow">
        <AppIcon name="search" :size="16" />
        <input v-model="filters.q" type="search" :placeholder="t('responses.search')" :aria-label="t('responses.search')" />
      </label>
      <select v-model="filters.status" class="input select compact" :aria-label="t('responses.filterStatus')">
        <option value="">{{ t('responses.allStatuses') }}</option>
        <option v-for="status in statuses" :key="status" :value="status">{{ t(statusKeys[status]) }}</option>
      </select>
      <DateRange v-model:from="filters.from" v-model:to="filters.to" />
      <button type="button" class="chip" :class="{ active: filters.starred }" :aria-pressed="filters.starred" @click="filters.starred = !filters.starred"><AppIcon name="star" :size="14" :filled="filters.starred" />{{ t('responses.starred') }}</button>
      <MenuButton :label="t('responses.export')" icon="download" :text="t('responses.export')" button-class="button">
        <a class="menu-item" :href="'/api/admin/forms/' + form.id + '/export' + exportQuery('csv')" download><AppIcon name="grid" :size="16" /><span>{{ t('export.csvWide') }}<small>{{ t('export.csvWideHint') }}</small></span></a>
        <a class="menu-item" :href="'/api/admin/forms/' + form.id + '/export' + exportQuery('long')" download><AppIcon name="menu" :size="16" /><span>{{ t('export.csvLong') }}<small>{{ t('export.csvLongHint') }}</small></span></a>
        <a class="menu-item" :href="'/api/admin/forms/' + form.id + '/export' + exportQuery('json')" download><AppIcon name="file" :size="16" /><span>{{ t('export.json') }}<small>{{ t('export.jsonHint') }}</small></span></a>
        <a class="menu-item" :href="'/api/admin/forms/' + form.id + '/attachments' + query(params)" download><AppIcon name="archive" :size="16" /><span>{{ t('export.zip') }}<small>{{ t('export.zipHint') }}</small></span></a>
      </MenuButton>
    </div>

    <div class="list-meta">
      <span>{{ filters.trash ? t('responses.trashCount', { count: formatNumber(total) }) : activeFilters ? t('responses.filteredCount', { count: formatNumber(total) }) : t('responses.totalCount', { count: formatNumber(total) }) }}</span>
      <button v-if="activeFilters" type="button" class="text-button small" @click="resetFilters">{{ t('responses.clearFilters') }}</button>
      <span class="spacer"></span>
      <select v-model="filters.sort" class="input select compact" :aria-label="t('forms.sort')">
        <option value="newest">{{ t('responses.newest') }}</option>
        <option value="oldest">{{ t('responses.oldest') }}</option>
      </select>
      <button type="button" class="chip" :class="{ active: filters.trash }" :aria-pressed="filters.trash" @click="filters.trash = !filters.trash"><AppIcon name="trash" :size="14" />{{ t('responses.trashView') }}</button>
    </div>

    <div v-if="selected.length && writable" class="batch-bar" role="region" :aria-label="t('responses.batch')">
      <strong>{{ t('responses.selected', { count: selected.length }) }}</strong>
      <template v-if="!filters.trash">
        <MenuButton :label="t('responses.setStatus')" :text="t('responses.setStatus')" icon="check" button-class="button small">
          <button v-for="status in statuses" :key="status" type="button" class="menu-item" @click="batch('status', { status })"><StatusBadge :status="status" /></button>
        </MenuButton>
        <button type="button" class="button small" :disabled="busy" @click="batch('star')"><AppIcon name="star" :size="14" />{{ t('responses.star') }}</button>
        <button type="button" class="button small" :disabled="busy" @click="batch('unstar')">{{ t('responses.unstar') }}</button>
        <button type="button" class="button small danger" :disabled="busy" @click="batch('trash')"><AppIcon name="trash" :size="14" />{{ t('responses.trash') }}</button>
      </template>
      <template v-else>
        <button type="button" class="button small" :disabled="busy" @click="batch('restore')"><AppIcon name="restore" :size="14" />{{ t('responses.restore') }}</button>
        <button v-if="allowed('responses.purge')" type="button" class="button small danger" :disabled="busy" @click="batch('purge')"><AppIcon name="trash" :size="14" />{{ t('responses.purge') }}</button>
      </template>
      <span class="spacer"></span>
      <button type="button" class="text-button small" @click="selected = []">{{ t('common.cancel') }}</button>
    </div>

    <div class="responses-split">
      <section class="response-list card flush" :aria-busy="loading">
        <div class="response-list-head">
          <label v-if="writable" class="check-row"><input type="checkbox" :checked="allSelected" :disabled="!items.length" :aria-label="t('responses.selectPage')" @change="toggleAll($event.target.checked)" /></label>
          <span>{{ t('responses.listTitle') }}</span>
        </div>
        <EmptyState v-if="!loading && !items.length" :icon="filters.trash ? 'trash' : 'inbox'" :title="activeFilters ? t('responses.noMatches') : filters.trash ? t('responses.trashEmpty') : t('responses.none')" :text="activeFilters || filters.trash ? '' : t('responses.noneHint')" compact />
        <ul v-else class="response-rows" :class="{ loading }">
          <li v-for="item in items" :key="item.id" class="response-row" :class="{ active: item.id === detailId, selected: selected.includes(item.id) }">
            <input v-if="writable" v-model="selected" type="checkbox" :value="item.id" :aria-label="t('responses.selectOne', { id: shortId(item.id) })" />
            <button type="button" class="star-button" :class="{ on: item.starred }" :disabled="!writable || filters.trash" :aria-pressed="item.starred" :aria-label="item.starred ? t('responses.unstar') : t('responses.star')" @click="toggleStar(item)"><AppIcon name="star" :size="16" :filled="item.starred" /></button>
            <button type="button" class="response-row-main" @click="open(item.id)">
              <span class="response-row-top">
                <span class="mono">#{{ shortId(item.id) }}</span>
                <StatusBadge :status="item.status" />
                <span v-if="item.attachments.length" class="muted small"><AppIcon name="paperclip" :size="12" />{{ item.attachments.length }}</span>
                <span v-if="item.note" class="muted small" :title="t('responses.note')"><AppIcon name="message" :size="12" /></span>
                <time class="muted small" :datetime="item.createdAt" :title="formatDate(item.createdAt)">{{ relativeTime(item.createdAt) }}</time>
              </span>
              <span class="response-row-summary clamp-2">{{ summarizeResponse(item) || t('responses.onlyFiles') }}</span>
            </button>
          </li>
        </ul>
        <footer class="response-list-foot">
          <select v-model.number="pageSize" class="input select compact" :aria-label="t('responses.pageSize')">
            <option :value="20">{{ t('responses.perPage', { count: 20 }) }}</option>
            <option :value="50">{{ t('responses.perPage', { count: 50 }) }}</option>
            <option :value="100">{{ t('responses.perPage', { count: 100 }) }}</option>
          </select>
          <PaginationBar :page="page" :total="total" :page-size="pageSize" :disabled="loading" @change="page = $event" />
        </footer>
      </section>

      <ResponseDetail
        v-if="detailId"
        :key="detailId"
        :response-id="detailId"
        :form="form"
        :has-previous="index > 0"
        :has-next="index >= 0 && index < items.length - 1"
        :writable="writable && !filters.trash"
        @close="close"
        @previous="open(items[index - 1].id)"
        @next="open(items[index + 1].id)"
        @updated="updated"
        @removed="removed"
      />
      <div v-else class="detail-placeholder card hide-mobile">
        <AppIcon name="inbox" :size="28" />
        <p>{{ t('responses.selectHint') }}</p>
      </div>
    </div>
  </div>
</template>
