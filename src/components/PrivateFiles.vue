<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { t } from '../i18n.js';
import { formatBytes } from '../lib/format.js';
import AppIcon from './AppIcon.vue';

// Files a respondent uploaded with their answers. They are listed but cannot be opened from
// the follow-up page; hovering (or tapping, on touch screens) a file explains why.
const props = defineProps({ files: { type: Array, default: () => [] } });
const tip = ref(null), bubble = ref(null);
const placement = ref({ visibility: 'hidden', top: '0px', left: '0px' });
const GAP = 8, MARGIN = 8;
let anchor = null, pinned = false;

const kind = name => /\.(png|jpe?g|webp|gif)$/i.test(name) ? 'image' : /\.(mp4|webm|mov)$/i.test(name) ? 'play' : 'file';

async function show(event, index, pin = false) {
  anchor = event.currentTarget;
  pinned = pin;
  tip.value = index;
  placement.value = { visibility: 'hidden', top: '0px', left: '0px' };
  await nextTick();
  place();
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);
}
// Taps can make the browser scroll the focused file into view; the note moves with it and
// closes once the file has left the screen.
let frame = 0;
function follow() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const rect = anchor?.getBoundingClientRect();
    if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) return hide();
    place();
  });
}
// Above the file when there is room, otherwise below; always inside the screen.
function place() {
  if (!anchor || !bubble.value) return;
  const rect = anchor.getBoundingClientRect();
  const width = bubble.value.offsetWidth, height = bubble.value.offsetHeight;
  const left = Math.min(Math.max(MARGIN, rect.left + rect.width / 2 - width / 2), document.documentElement.clientWidth - width - MARGIN);
  const top = rect.top - GAP - height >= MARGIN ? rect.top - GAP - height : rect.bottom + GAP;
  placement.value = { top: `${Math.round(top)}px`, left: `${Math.round(left)}px` };
}
function hide() {
  cancelAnimationFrame(frame);
  tip.value = null;
  anchor = null;
  pinned = false;
  document.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('scroll', follow, true);
  window.removeEventListener('resize', follow);
}
const outside = event => { if (!anchor?.contains(event.target)) hide(); };
// A tap keeps the note open until the next tap; a mouse only shows it while hovering.
const toggle = (event, index) => tip.value === index && pinned ? hide() : show(event, index, true);
const leave = () => { if (!pinned) hide(); };
onBeforeUnmount(hide);
</script>

<template>
  <ul class="private-files">
    <li v-for="(file, index) in props.files" :key="file.name + index">
      <button type="button" class="private-file" :aria-describedby="tip === index ? 'private-file-tip' : undefined"
        @mouseenter="show($event, index)" @mouseleave="leave" @focus="show($event, index)" @blur="leave" @click="toggle($event, index)" @keydown.esc="hide">
        <AppIcon :name="kind(file.name)" :size="16" class="private-file-icon" />
        <span class="private-file-name">{{ file.name }}</span>
        <small>{{ formatBytes(file.size) }}</small>
        <AppIcon name="lock" :size="13" class="private-file-lock" />
      </button>
    </li>
  </ul>
  <Teleport to="body">
    <div v-if="tip !== null" id="private-file-tip" ref="bubble" class="private-file-tip" role="tooltip" :style="placement">
      <AppIcon name="shield" :size="14" />{{ t('ticket.privateFile') }}
    </div>
  </Teleport>
</template>
