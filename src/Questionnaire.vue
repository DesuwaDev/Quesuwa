<script setup>
import { computed, reactive, ref, watch, onBeforeUnmount } from 'vue';
const props = defineProps({ form: { type: Object, required: true }, preview: Boolean });
const emit = defineEmits(['submitted']);
const answers = reactive({});
const uploads = reactive({});
const errors = reactive({});
const busy = ref(false), error = ref(''), website = ref('');
const requiredCount = computed(() => props.form.fields.filter(f => f.required).length);
const completed = computed(() => props.form.fields.filter(f => f.required && (f.type === 'file' ? uploads[f.id]?.length : Array.isArray(answers[f.id]) ? answers[f.id].length : answers[f.id]?.trim())).length);
function clearFiles() { for (const items of Object.values(uploads)) for (const item of items) if (item.url) URL.revokeObjectURL(item.url); }
watch(() => props.form.id, () => { clearFiles(); for (const key of Object.keys(answers)) delete answers[key]; for (const key of Object.keys(uploads)) delete uploads[key]; });
onBeforeUnmount(clearFiles);
function toggle(id, option, checked) {
  const current = answers[id] || [];
  answers[id] = checked ? [...current, option] : current.filter(x => x !== option);
}
function addFiles(field, list) {
  errors[field.id] = '';
  const current = uploads[field.id] || [];
  const selected = [...list];
  if (current.length + selected.length > 3) { errors[field.id] = '每道题最多上传 3 个文件'; return; }
  for (const file of selected) {
    if (file.size > 10 * 1024 * 1024 || file.size === 0) { errors[field.id] = '请选择非空文件，每个不超过 10 MB'; return; }
    if (!/\.(png|jpe?g|webp|gif|pdf|txt|log)$/i.test(file.name)) { errors[field.id] = '支持图片、PDF、TXT 和 LOG 文件'; return; }
  }
  uploads[field.id] = [...current, ...selected.map(file => ({ file, url: /^image\/(png|jpeg|webp|gif)$/.test(file.type) ? URL.createObjectURL(file) : null }))];
}
function removeFile(id, index) { const [item] = uploads[id].splice(index, 1); if (item.url) URL.revokeObjectURL(item.url); }
async function submit() {
  if (props.preview) return;
  error.value = '';
  for (const key of Object.keys(errors)) delete errors[key];
  for (const field of props.form.fields) {
    const value = field.type === 'file' ? uploads[field.id] : answers[field.id];
    if (field.required && (!value || (Array.isArray(value) ? !value.length : !value.trim()))) errors[field.id] = '请填写这一题';
  }
  if (Object.keys(errors).length) { error.value = '还有必填项没有完成，请查看下方提示'; return; }
  busy.value = true;
  try {
    const body = new FormData();
    body.append('answers', JSON.stringify(answers)); body.append('version', String(props.form.version)); body.append('website', website.value);
    for (const [id, items] of Object.entries(uploads)) for (const { file } of items) body.append(id, file);
    const response = await fetch(`/api/forms/${encodeURIComponent(props.form.slug)}/responses`, { method: 'POST', body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '提交失败，请稍后重试');
    emit('submitted', data);
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
</script>

<template>
  <form class="questionnaire" @submit.prevent="submit" novalidate>
    <div class="form-intro">
      <div class="eyebrow"><span class="live-dot"></span>{{ preview ? '问卷预览' : '让每一份声音被听见' }}</div>
      <h1>{{ form.title || '未命名问卷' }}</h1>
      <p class="intro-copy preserve">{{ form.description }}</p>
      <div class="form-meta"><span>无需登录</span><span>{{ form.fields.length }} 道题目</span><span>{{ requiredCount }} 项必填</span></div>
    </div>
    <div v-if="requiredCount" class="progress-row"><span>完成 {{ completed }} / {{ requiredCount }} 项必填</span><div class="progress-track"><div :style="{ width: `${completed / requiredCount * 100}%` }"></div></div></div>
    <div class="trap" aria-hidden="true"><label>Website<input v-model="website" tabindex="-1" autocomplete="off" /></label></div>
    <fieldset v-for="(field, index) in form.fields" :key="field.id" class="question-card" :disabled="busy">
      <legend><span class="question-number">{{ String(index + 1).padStart(2, '0') }}</span><span>{{ field.label }}</span><span class="require-tag">{{ field.required ? '必填' : '选填' }}</span></legend>
      <p v-if="field.description" class="hint preserve" :id="`hint-${field.id}`">{{ field.description }}</p>
      <input v-if="field.type === 'short'" v-model="answers[field.id]" :aria-label="field.label" :aria-describedby="`hint-${field.id}`" :aria-required="field.required" :aria-invalid="!!errors[field.id]" maxlength="1000" placeholder="在这里填写…" />
      <textarea v-else-if="field.type === 'long'" v-model="answers[field.id]" :aria-label="field.label" :aria-describedby="`hint-${field.id}`" :aria-required="field.required" :aria-invalid="!!errors[field.id]" maxlength="10000" rows="4" placeholder="按你实际遇到的情况描述就好…"></textarea>
      <div v-else-if="field.type === 'single' || field.type === 'multi'" class="choices">
        <label v-for="option in field.options" :key="option" class="choice" :class="{ selected: field.type === 'single' ? answers[field.id] === option : answers[field.id]?.includes(option) }">
          <input v-if="field.type === 'single'" type="radio" :name="field.id" :value="option" v-model="answers[field.id]" />
          <input v-else type="checkbox" :checked="answers[field.id]?.includes(option) || false" @change="toggle(field.id, option, $event.target.checked)" />
          <span>{{ option }}</span>
        </label>
      </div>
      <select v-else-if="field.type === 'select'" v-model="answers[field.id]" :aria-label="field.label"><option :value="undefined" disabled>请选择一个选项</option><option v-for="option in field.options" :key="option">{{ option }}</option></select>
      <div v-else-if="field.type === 'file'">
        <label class="upload-zone" @dragover.prevent @drop.prevent="addFiles(field, $event.dataTransfer.files)">
          <span class="upload-symbol">↥</span><strong>点击选择，或把文件拖到这里</strong><span>图片 / PDF / TXT / LOG · 最多 3 个 · 每个 10 MB</span>
          <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.log" :aria-label="field.label" @change="addFiles(field, $event.target.files); $event.target.value = ''" />
        </label>
        <ul v-if="uploads[field.id]?.length" class="file-list"><li v-for="(item, i) in uploads[field.id]" :key="i"><img v-if="item.url" :src="item.url" alt="附件预览" /><span v-else class="file-icon">↗</span><span class="file-label">{{ item.file.name }}<small>{{ (item.file.size / 1024).toFixed(1) }} KB</small></span><button type="button" class="icon-button" :aria-label="`移除 ${item.file.name}`" @click="removeFile(field.id, i)">×</button></li></ul>
      </div>
      <p v-if="errors[field.id]" class="error" role="alert">{{ errors[field.id] }}</p>
    </fieldset>
    <div class="submit-area"><p v-if="error" class="error" role="alert">{{ error }}</p><button class="button primary submit-button" :disabled="busy || preview" type="submit">{{ preview ? '预览模式，不会提交' : busy ? '正在提交，请稍候…' : '提交答卷' }} <span v-if="!busy">↗</span></button><p class="muted small">请勿上传密码、密钥等敏感信息。答卷与附件仅管理员可见。</p></div>
  </form>
</template>
