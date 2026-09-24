<script setup>
defineProps({ modelValue: Boolean, label: String, hint: String, disabled: Boolean });
defineEmits(['update:modelValue']);
</script>

<template>
  <label class="switch-row" :class="{ disabled }">
    <span class="switch-text"><span class="switch-label">{{ label }}</span><small v-if="hint">{{ hint }}</small></span>
    <input type="checkbox" role="switch" class="switch-input" :checked="modelValue" :disabled="disabled" @change="$emit('update:modelValue', $event.target.checked)" />
    <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
  </label>
</template>
