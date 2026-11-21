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
    <el-card
      v-for="group in (result.image_groups || [])"
      :key="group.group_key"
      class="image-group-card"
      :body-style="{ padding: '12px' }"
    >
      <div class="binding-header">
        <div class="binding-title">
          <strong>{{ group.label }}</strong>
          <el-tag
            size="small"
            type="success"
          >
            image_list
          </el-tag>
          <el-text
            type="info"
            class="binding-path"
          >
            {{ group.node_titles.join('、') }}
          </el-text>
        </div>
        <div>
          <el-text type="info">
            导出为多图参数
          </el-text>
          <el-switch
            :model-value="Boolean(drafts[groupDraftKey(group.group_key)])"
            @update:model-value="$emit('toggle-group', group)"
          />
        </div>
      </div>
      <DraftEditor
        v-if="drafts[groupDraftKey(group.group_key)]"
        :draft="drafts[groupDraftKey(group.group_key)]"
        @change="(patch) => $emit('update-draft', groupDraftKey(group.group_key), patch)"
      />
    </el-card>
    <el-text
      type="info"
      class="binding-hint"
    >
      连线输入与包装控件不可导出；普通控件可直接修改固定值，或勾选「导出」配置为外部参数。
      连续命名的「参考图N」建议合并为上方的多图参数，由调用方按实际张数传数组。
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
import DraftEditor from '@/render/components/workflow/DraftEditor.vue';
import { getAtPath, imageGroupDraftKey, pathKey } from '@/render/common/workflowUtil';

export default {
    name: 'BindingStep',
    components: { BindingRow, DraftEditor },
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
    emits: ['toggle', 'toggle-group', 'update-draft', 'update-fixed'],
    methods: {
        pathKey,
        groupDraftKey: imageGroupDraftKey,
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
.image-group-card {
  border-color: #b3e19d;
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
