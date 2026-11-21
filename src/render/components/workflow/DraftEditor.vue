<template>
  <div class="draft-editor">
    <div class="draft-row">
      <el-input
        :model-value="draft.key"
        style="width: 240px"
        @update:model-value="(val) => emitChange({ key: val })"
      >
        <template #prepend>
          key
        </template>
      </el-input>
      <el-input
        :model-value="draft.label"
        style="width: 240px"
        @update:model-value="(val) => emitChange({ label: val })"
      >
        <template #prepend>
          名称
        </template>
      </el-input>
      <el-select
        :model-value="draft.type"
        style="width: 160px"
        @update:model-value="onTypeChange"
      >
        <el-option
          v-for="item in TYPE_OPTIONS"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <span class="inline-field">
        必填
        <el-switch
          :model-value="draft.required"
          @update:model-value="(val) => emitChange({ required: val })"
        />
      </span>
      <span
        v-if="draft.type === 'string'"
        class="inline-field"
      >
        多行
        <el-switch
          :model-value="draft.multiline"
          @update:model-value="(val) => emitChange({ multiline: val })"
        />
      </span>
    </div>
    <div
      v-if="draft.type === 'int' || draft.type === 'float'"
      class="draft-row"
    >
      <span class="inline-field">
        <span class="field-label">最小值</span>
        <el-input-number
          :model-value="draft.min"
          @update:model-value="(val) => emitChange({ min: val })"
        />
      </span>
      <span class="inline-field">
        <span class="field-label">最大值</span>
        <el-input-number
          :model-value="draft.max"
          @update:model-value="(val) => emitChange({ max: val })"
        />
      </span>
      <span class="inline-field">
        <span class="field-label">默认值</span>
        <el-input-number
          :model-value="numberDefault"
          @update:model-value="(val) => emitChange({ default: val })"
        />
      </span>
    </div>
    <div
      v-if="draft.type === 'enum'"
      class="draft-row"
    >
      <el-select
        :model-value="draft.enum_source || undefined"
        style="width: 260px"
        clearable
        placeholder="动态枚举来源（可选）"
        @update:model-value="(val) => emitChange({ enum_source: val || null })"
      >
        <el-option
          v-for="item in ENUM_SOURCE_OPTIONS"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <el-input
        v-if="!draft.enum_source"
        :model-value="(draft.choices || []).join('\n')"
        type="textarea"
        :rows="2"
        style="width: 360px"
        placeholder="静态枚举，每行一个选项"
        @update:model-value="onChoicesChange"
      />
    </div>
    <div
      v-if="draft.type === 'string'"
      class="draft-row"
    >
      <el-input
        :model-value="stringDefault"
        style="max-width: 600px"
        @update:model-value="(val) => emitChange({ default: val })"
      >
        <template #prepend>
          默认值
        </template>
      </el-input>
    </div>
    <div
      v-if="draft.type === 'bool'"
      class="draft-row"
    >
      <span class="inline-field">
        <span class="field-label">默认值</span>
        <el-switch
          :model-value="Boolean(draft.default)"
          @update:model-value="(val) => emitChange({ default: val })"
        />
      </span>
    </div>
    <div
      v-if="draft.type === 'image'"
      class="draft-row"
    >
      <el-input
        :model-value="stringDefault"
        style="max-width: 600px"
        placeholder="默认文件名（ComfyUI input 目录，留空则该图片参数必填）"
        @update:model-value="(val) => emitChange({ default: val || null })"
      >
        <template #prepend>
          默认文件名
        </template>
      </el-input>
    </div>
    <div
      v-if="draft.type === 'image_list'"
      class="draft-row"
    >
      <el-tag
        v-for="(label, index) in imageNodeLabels"
        :key="index"
        size="small"
        type="info"
      >
        {{ index + 1 }}. {{ label }}
      </el-tag>
      <el-text
        v-if="!imageNodeLabels.length"
        type="warning"
        size="small"
      >
        多图参数需要 image_nodes 节点列表，请通过参考图分组卡片创建，或手写定义 JSON
      </el-text>
    </div>
  </div>
</template>

<script>
import { ENUM_SOURCE_OPTIONS, TYPE_OPTIONS } from '@/render/common/workflowUtil';

export default {
    name: 'DraftEditor',
    props: {
        draft: {
            type: Object,
            required: true,
        },
    },
    emits: ['change'],
    data() {
        return {
            TYPE_OPTIONS,
            ENUM_SOURCE_OPTIONS,
        };
    },
    computed: {
        numberDefault() {
            return this.draft.default === null || this.draft.default === undefined
                ? undefined
                : Number(this.draft.default);
        },
        stringDefault() {
            return this.draft.default === null || this.draft.default === undefined
                ? ''
                : String(this.draft.default);
        },
        imageNodeLabels() {
            const titles = this.draft.image_node_titles || [];
            const nodes = this.draft.image_nodes || [];
            return nodes.map((nodeId, index) => titles[index] || `节点 ${nodeId}`);
        },
    },
    methods: {
        emitChange(patch) {
            this.$emit('change', patch);
        },
        onTypeChange(type) {
            const patch = {
                type,
                choices: type === 'enum' ? this.draft.choices : null,
                enum_source: type === 'enum' ? this.draft.enum_source : null,
            };
            if (type !== 'image_list') {
                patch.image_nodes = null;
                patch.image_node_titles = null;
            }
            this.emitChange(patch);
        },
        onChoicesChange(text) {
            this.emitChange({
                choices: text
                    .split('\n')
                    .map((item) => item.trim())
                    .filter(Boolean),
            });
        },
    },
};
</script>

<style scoped>
.draft-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.draft-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.inline-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.field-label {
  color: #606266;
  font-size: 13px;
}
</style>
