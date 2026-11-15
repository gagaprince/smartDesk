<template>
  <div class="binding-step">
    <el-alert
      v-if="result.warnings.length > 0"
      type="warning"
      :closable="false"
      show-icon
      title="解析告警"
      :description="result.warnings.join('；')"
    />
    <el-text
      type="info"
      class="binding-hint"
    >
      连线输入与包装控件不可导出；普通控件可直接修改固定值，或勾选「导出」配置为外部参数。
    </el-text>
    <el-collapse>
      <el-collapse-item
        v-for="node in result.nodes"
        :key="node.node_id"
        :name="node.node_id"
      >
        <template #title>
          <div class="node-title">
            <strong>{{ node.node_id }} · {{ node.title || node.class_type }}</strong>
            <el-tag size="small">
              {{ node.class_type }}
            </el-tag>
            <el-tag
              v-if="node.is_output_candidate"
              size="small"
              type="warning"
            >
              输出候选
            </el-tag>
          </div>
        </template>
        <div class="node-inputs">
          <BindingRow
            v-for="input in node.inputs"
            :key="pathKey(input.path)"
            :input="input"
            :fixed-value="getAtPath(graph, input.path)"
            :draft="drafts[pathKey(input.path)]"
            @toggle="$emit('toggle', input)"
            @update-draft="(patch) => $emit('update-draft', pathKey(input.path), patch)"
            @update-fixed="(val) => $emit('update-fixed', input.path, val)"
          />
        </div>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script>
import BindingRow from '@/render/components/workflow/BindingRow.vue';
import { getAtPath, pathKey } from '@/render/common/workflowUtil';

export default {
    name: 'BindingStep',
    components: { BindingRow },
    props: {
        result: {
            type: Object,
            required: true,
        },
        graph: {
            type: Object,
            required: true,
        },
        drafts: {
            type: Object,
            required: true,
        },
    },
    emits: ['toggle', 'update-draft', 'update-fixed'],
    methods: {
        pathKey,
        getAtPath,
    },
};
</script>

<style scoped>
.binding-step {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.binding-hint {
  display: block;
}
.node-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.node-inputs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
