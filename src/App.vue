<script setup>
import { computed, onMounted, ref } from 'vue';
import Questionnaire from './Questionnaire.vue';
import Admin from './Admin.vue';
const admin = window.location.pathname.replace(/\/$/, '') === '/admin';
const slug = /^\/f\/([^/]+)\/?$/.exec(window.location.pathname)?.[1];
const form = ref(null), forms = ref([]), loading = ref(true), error = ref(''), success = ref(null);
function onSubmitted(data) { success.value = data; window.scrollTo(0, 0); }
const submittedId = computed(() => success.value?.id?.slice(0, 8).toUpperCase());
onMounted(async () => {
  if (admin) return;
  try {
    const response = await fetch(slug ? `/api/forms/${slug}` : '/api/forms');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '页面暂时无法打开');
    if (slug) form.value = data; else forms.value = data;
  } catch (e) { error.value = e.message; } finally { loading.value = false; }
});
</script>
<template>
  <Admin v-if="admin" />
  <div v-else class="public-shell">
    <header class="public-header"><a class="brand" href="/"><span class="brand-mark">Q</span><span>Quesuwa<span class="brand-divider">/</span><span class="brand-sub">问卷与反馈</span></span></a><span class="header-caption">每一份反馈，都有回响。</span></header>
    <main class="public-main">
      <div v-if="loading" class="state-card">正在打开问卷…</div>
      <div v-else-if="error" class="state-card"><span class="state-icon">—</span><h1>暂时无法填写</h1><p>{{ error }}</p><a class="button" href="/">返回首页</a></div>
      <div v-else-if="success" class="state-card success-card" role="status"><span class="state-icon success-icon">✓</span><div class="eyebrow">已成功送达</div><h1>谢谢你的认真填写。</h1><p class="preserve">{{ success.thanks }}</p><div class="receipt">答卷编号 <strong>{{ submittedId }}</strong><small>需要补充内容时，可以向管理员提供这个编号。</small></div><a href="/" class="button">返回问卷首页 ↗</a></div>
      <Questionnaire v-else-if="form" :form="form" @submitted="onSubmitted" />
      <div v-else>
        <div class="form-intro"><div class="eyebrow"><span class="live-dot"></span>开放中的问卷</div><h1>我们想听听你的声音。</h1><p class="intro-copy">简单填写，自由表达。你的每一个建议，都是下一次改善的开始。</p></div>
        <div v-if="!forms.length" class="state-card"><p>暂时没有开放中的问卷，请稍后再来。</p></div>
        <a v-for="item in forms" :key="item.id" class="survey-link" :href="`/f/${item.slug}`"><div><span class="eyebrow">{{ item.fieldCount }} 道题 · 无需登录</span><h2>{{ item.title }}</h2><p>{{ item.description }}</p></div><span class="survey-arrow">↗</span></a>
      </div>
    </main>
    <footer class="public-footer"><span>Quesuwa · 把反馈变成更好的体验</span><a href="/admin">管理入口</a></footer>
  </div>
</template>
