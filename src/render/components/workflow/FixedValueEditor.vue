<template>
  <div>
    <el-switch
      v-if="input.inferred_type === 'bool'"
      :model-value="Boolean(value)"
      @update:model-value="(val) => $emit('change', val)"
    />
    <el-input-number
      v-else-if="input.inferred_type === 'int' || input.inferred_type === 'float'"
      :model-value="numberValue"
      :min="input.min === null || input.min === undefined ? undefined : input.min"
      :max="input.max === null || input.max === undefined ? undefined : input.max"
      @update:model-value="(val) => $emit('change', val)"
    />
    <el-select
      v-else-if="input.inferred_type === 'enum'"
      :model-value="enumValue"
      filterable
      style="min-width: 280px"
      @update:model-value="(val) => $emit('change', val)"
    >
      <el-option
        v-for="item in (input.choices || [])"
        :key="item"
        :label="item"
        :value="item"
      />
    </el-select>
    <el-input
      v-else-if="input.multiline"
      :model-value="stringValue"
      type="textarea"
      :rows="2"
      @update:model-value="(val) => $emit('change', val)"
    />
    <el-input
      v-else
      :model-value="stringValue"
      style="max-width: 420px"
      @update:model-value="(val) => $emit('change', val)"
    />
  </div>
</template>

<script>
export default {
    name: 'FixedValueEditor',
    props: {
        input: {
            type: Object,
            required: true,
        },
        value: {
            type: null,
            default: undefined,
        },
    },
    emits: ['change'],
    computed: {
        numberValue() {
            return this.value === undefined || this.value === null
                ? undefined
                : Number(this.value);
        },
        stringValue() {
            return this.value === undefined || this.value === null
                ? ''
                : String(this.value);
        },
        enumValue() {
            return this.value === undefined || this.value === null
                ? undefined
                : String(this.value);
        },
    },
};
</script>
