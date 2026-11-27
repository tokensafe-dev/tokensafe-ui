<template>
  <main>
    <h1>OUMV Vue certification app</h1>
    <button data-agent-id="probe-btn" @click="bump">Probe {{ probes }}</button>
  </main>
</template>

<script setup>
import { onMounted, ref } from 'vue';

const probes = ref(0);

function bump() {
  probes.value += 1;
}

onMounted(() => {
  let done = false;
  const register = () => {
    if (done) return;
    if (window.__OUMV_VUE__) {
      done = true;
      window.__OUMV_VUE__.registerStore(
        'certificationProbe',
        () => ({ probes: probes.value }),
        { 'conformance-probe': () => bump() }
      );
      // One real request produces a real L4 trace.
      fetch('/api/stats').catch(() => {});
      return;
    }
    setTimeout(register, 50);
  };
  register();
});
</script>
