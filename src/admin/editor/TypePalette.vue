<script setup>
import { t } from '../../i18n.js';
import { fieldGroups, fieldTypes, fieldTypeHints } from '../../../shared/constants.js';
import { fieldIcons } from '../../components/icons.js';
import AppIcon from '../../components/AppIcon.vue';

defineProps({ disabled: { type: Array, default: () => [] }, compact: Boolean, inline: Boolean });
const emit = defineEmits(['pick']);
</script>

<template>
  <div class="type-palette" :class="{ compact, inline }">
    <section v-for="group in fieldGroups" :key="group.key" class="type-group">
      <h4>{{ t(group.key) }}</h4>
      <div class="type-grid">
        <button v-for="type in group.types" :key="type" type="button" class="type-button" :disabled="disabled.includes(type)" :title="t(fieldTypeHints[type])" @click="emit('pick', type)">
          <span class="type-icon"><AppIcon :name="fieldIcons[type]" :size="16" /></span>
          <span class="type-text"><strong>{{ t(fieldTypes[type]) }}</strong><small v-if="!compact">{{ t(fieldTypeHints[type]) }}</small></span>
        </button>
      </div>
    </section>
  </div>
</template>
