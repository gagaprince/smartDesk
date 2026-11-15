<template>
  <el-card
    class="binding-row"
    :body-style="{ padding: '12px' }"
    :style="{ background: exported ? '#f0f7ff' : '#fafafa' }"
  >
    <template #header>
      <div class="binding-header">
        <div class="binding-title">
          <strong>{{ input.input_name }}</strong>
          <el-tag size="small">
            {{ kindText }}
          </el-tag>
          <el-text
            type="info"
            class="binding-path"
          >
            {{ input.path.join(' / ') }}
          </el-text>
        </div>
        <div v-if="exportable">
          <el-text type="info">
            导出为参数
          </el-text>
          <el-switch
            :model-value="exported"
            @update:model-value="$emit('toggle')"
          />
        </div>
        <el-tag
          v-else
          size="small"
        >
          不可导出
        </el-tag>
      </div>
    </template>
    <FixedValueEditor
      v-if="!exported && exportable"
      :input="input"
      :value="fixedValue"
      @change="(val) => $emit('update-fixed', val)"
    />
    <DraftEditor
      v-if="draft"
      :draft="draft"
      @change="(patch) => $emit('update-draft', patch)"
    />
    <el-text
      v-if="!exportable"
      type="info"
    >
      当前值：{{ JSON.stringify(input.current_value) }}
    </el-text>
  </el-card>
</template>

<script>
import FixedValueEditor from '@/render/components/workflow/FixedValueEditor.vue';
import DraftEditor from '@/render/components/workflow/DraftEditor.vue';

export default {
    name: 'BindingRow',
    components: { FixedValueEditor, DraftEditor },
    props: {
        input: {
            type: Object,
            required: true,
        },
        fixedValue: {
            type: null,
            default: undefined,
        },
        draft: {
            type: Object,
            default: null,
        },
    },
    emits: ['toggle', 'update-draft', 'update-fixed'],
    computed: {
        exportable() {
            return this.input.kind === 'widget';
        },
        exported() {
            return Boolean(this.draft);
        },
        kindText() {
            if (this.input.kind === 'link') return '连线';
            if (this.input.kind === 'wrapper') return '包装控件';
            return this.input.inferred_type;
        },
    },
};
</script>

<style scoped>
.binding-row {
  border-radius: 6px;
}
.binding-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.binding-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.binding-path {
  font-size: 12px;
}
</style>
