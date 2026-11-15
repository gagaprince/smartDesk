<template>
  <el-form
    v-if="params.length"
    label-position="top"
    :disabled="disabled"
  >
    <el-form-item
      v-for="param in params"
      :key="param.key"
      :label="param.label"
      :required="param.required"
    >
      <el-switch
        v-if="param.type === 'bool'"
        :model-value="boolValue(param.key)"
        active-text="开"
        inactive-text="关"
        @update:model-value="(value) => emitChange(param.key, value)"
      />
      <el-select
        v-else-if="param.type === 'enum'"
        :model-value="enumValue(param)"
        :loading="!!enumLoading[param.enum_source]"
        filterable
        clearable
        style="max-width: 480px"
        placeholder="请选择"
        @update:model-value="(value) => emitChange(param.key, value === '' ? null : value)"
      >
        <el-option
          v-for="item in enumOptions(param)"
          :key="item"
          :label="item"
          :value="item"
        />
      </el-select>
      <el-input-number
        v-else-if="param.type === 'int' || param.type === 'float'"
        :model-value="numberValue(param.key)"
        :step="param.type === 'float' ? 0.1 : 1"
        :min="param.min === null || param.min === undefined ? undefined : param.min"
        :max="param.max === null || param.max === undefined ? undefined : param.max"
        @update:model-value="(value) => emitChange(param.key, value)"
      />
      <el-input
        v-else-if="param.multiline"
        :model-value="stringValue(param.key)"
        type="textarea"
        :rows="4"
        maxlength="4000"
        show-word-limit
        @update:model-value="(value) => emitChange(param.key, value)"
      />
      <el-input
        v-else
        :model-value="stringValue(param.key)"
        style="max-width: 480px"
        @update:model-value="(value) => emitChange(param.key, value)"
      />
      <div class="param-key-hint">
        参数 key：{{ param.key }}
      </div>
    </el-form-item>
  </el-form>
  <el-text
    v-else
    type="info"
  >
    该工作流没有配置外部参数，直接提交即可。
  </el-text>
</template>

<script>
import { fetchEnumOptions } from '@/render/common/comfyuiApi';

export default {
    name: 'DynamicParamsForm',
    props: {
        params: {
            type: Array,
            default: () => [],
        },
        values: {
            type: Object,
            default: () => ({}),
        },
        disabled: {
            type: Boolean,
            default: false,
        },
    },
    emits: ['change'],
    data() {
        return {
            enumCache: {},
            enumLoading: {},
        };
    },
    watch: {
        params: {
            immediate: true,
            handler() {
                this.loadEnumOptions();
            },
        },
    },
    methods: {
        async loadEnumOptions() {
            const sources = [...new Set(
                this.params
                    .map((param) => param.enum_source)
                    .filter(Boolean),
            )].filter(
                (source) => !(source in this.enumCache) && !this.enumLoading[source],
            );
            if (!sources.length) return;
            sources.forEach((source) => {
                this.enumLoading[source] = true;
            });
            await Promise.all(sources.map(async (source) => {
                try {
                    const result = await fetchEnumOptions(source);
                    this.enumCache[source] = result.options;
                } catch (err) {
                    // 动态枚举仅作辅助, 拉取失败时静态 choices 仍可使用
                    this.enumCache[source] = [];
                } finally {
                    this.enumLoading[source] = false;
                }
            }));
        },
        emitChange(key, value) {
            this.$emit('change', key, value);
        },
        boolValue(key) {
            return Boolean(this.values[key]);
        },
        numberValue(key) {
            const value = this.values[key];
            return value === undefined || value === null ? undefined : Number(value);
        },
        stringValue(key) {
            const value = this.values[key];
            return value === undefined || value === null ? '' : String(value);
        },
        enumValue(param) {
            const value = this.values[param.key];
            return value === undefined || value === null ? undefined : String(value);
        },
        enumOptions(param) {
            if (param.enum_source) {
                return this.enumCache[param.enum_source] || [];
            }
            return param.choices || [];
        },
    },
};
</script>

<style scoped>
.param-key-hint {
  font-size: 12px;
  line-height: 1.4;
  color: #909399;
}
</style>
