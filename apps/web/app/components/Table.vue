<script setup lang="ts">
defineProps<{
  caption: string
  columns: readonly { key: string; label: string }[]
  rows: readonly { id: string; [key: string]: string | number }[]
  emptyLabel?: string
}>()
</script>

<template>
  <div class="table-wrap corner-card shadow-grounded" role="region" :aria-label="caption" tabindex="0">
    <table class="table">
      <caption>{{ caption }}</caption>
      <thead><tr><th v-for="column in columns" :key="column.key" scope="col">{{ column.label }}</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id"><component :is="index === 0 ? 'th' : 'td'" v-for="(column, index) in columns" :key="column.key" :scope="index === 0 ? 'row' : undefined"><slot name="cell" :row="row" :column="column">{{ row[column.key] }}</slot></component></tr>
        <tr v-if="!rows.length"><td :colspan="Math.max(1, columns.length)">{{ emptyLabel || 'No results to show.' }}</td></tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.table-wrap { max-width: 100%; overflow-x: auto; border: 1px solid var(--color-border-soft); background: var(--color-surface); color: var(--color-text); }
.table-wrap:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 3px; }
.table { width: 100%; border-collapse: collapse; font: var(--font-body) / var(--line-body) var(--font-family-body); font-variant-numeric: tabular-nums; text-wrap: pretty; }
caption { text-align: start; padding: var(--gap-standard); font-weight: var(--weight-bold); }
th, td { padding: var(--gap-standard); text-align: start; vertical-align: top; border-block-start: 1px solid var(--color-border-soft); min-width: 6rem; }
thead { background: var(--color-surface-raised); }
thead th { font-size: var(--font-small); font-weight: var(--weight-semibold); }
tbody th { font-weight: var(--weight-semibold); }
</style>
