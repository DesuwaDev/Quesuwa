<script setup>
import { t } from '../i18n.js';
import { statusKeys, stateKeys } from '../../shared/constants.js';
defineProps({ status: String, state: String, trashed: Boolean });
</script>

<template>
  <span v-if="trashed" class="badge muted">{{ t('forms.inTrash') }}</span>
  <span v-else-if="state" class="badge" :class="'state-' + state"><span class="badge-dot"></span>{{ t(stateKeys[state] || 'state.draft') }}</span>
  <span v-else class="badge" :class="'status-' + status"><span class="badge-dot"></span>{{ t(statusKeys[status] || 'status.pending') }}</span>
</template>
