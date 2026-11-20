<template>
  <el-dialog
    :model-value="modelValue"
    title="选择 LoRA 模型"
    width="72%"
    top="6vh"
    @update:model-value="handleVisibleUpdate"
    @open="handleOpen"
  >
    <div class="picker-filters">
      <el-input
        v-model="keyword"
        class="search-input"
        placeholder="按模型名称搜索"
        clearable
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <div
        v-for="dim in library.dimensions"
        :key="dim.id"
        class="filter-row"
      >
        <span class="filter-label">{{ dim.name }}</span>
        <el-checkbox-group
          v-model="filters[dim.id]"
          size="small"
        >
          <el-checkbox-button
            v-for="cat in dim.categories"
            :key="cat.id"
            :value="cat.id"
          >
            {{ cat.name }}
          </el-checkbox-button>
        </el-checkbox-group>
      </div>
    </div>
    <div class="picker-grid">
      <div
        v-for="lora in filteredLoras"
        :key="lora.name"
        class="lora-card"
        :class="{ active: lora.name === selected }"
        @click="handleSelect(lora.name)"
      >
        <div class="thumb-wrap">
          <el-image
            v-if="lora.thumbnail_ready"
            :src="thumbUrl(lora.name)"
            fit="cover"
            class="thumb"
          >
            <template #error>
              <div class="thumb-placeholder">
                暂无图片
              </div>
            </template>
          </el-image>
          <div
            v-else
            class="thumb-placeholder"
          >
            暂无图片
          </div>
        </div>
        <div
          class="card-name"
          :title="lora.name"
        >
          {{ lora.name }}
        </div>
        <div class="card-tags">
          <el-tag
            v-for="tag in tagChips(lora)"
            :key="tag"
            size="small"
            type="info"
          >
            {{ tag }}
          </el-tag>
        </div>
      </div>
      <el-empty
        v-if="!filteredLoras.length"
        description="没有符合筛选条件的模型"
      />
    </div>
    <template #footer>
      <el-button @click="handleVisibleUpdate(false)">
        取消
      </el-button>
      <el-button
        type="info"
        @click="handleClear"
      >
        清除选择
      </el-button>
    </template>
  </el-dialog>
</template>

<script>
import { buildLoraThumbnailUrl } from '@/render/common/comfyuiApi';

const FILTERS_STORAGE_KEY = 'lora-picker-filters';

export default {
    name: 'LoraPickerModal',
    props: {
        modelValue: {
            type: Boolean,
            default: false,
        },
        selected: {
            type: String,
            default: '',
        },
        library: {
            type: Object,
            default: () => ({ dimensions: [], loras: [] }),
        },
        thumbBust: {
            type: Number,
            default: 0,
        },
    },
    emits: ['update:modelValue', 'select'],
    data() {
        return {
            keyword: '',
            filters: {},
        };
    },
    computed: {
        filteredLoras() {
            const keyword = this.keyword.trim().toLowerCase();
            return this.library.loras.filter((lora) => {
                if (keyword && !lora.name.toLowerCase().includes(keyword)) {
                    return false;
                }
                return this.library.dimensions.every((dim) => {
                    const picked = this.filters[dim.id];
                    if (!picked || !picked.length) {
                        return true;
                    }
                    const owned = lora.tags?.[dim.id] || [];
                    return picked.some((id) => owned.includes(id));
                });
            });
        },
    },
    watch: {
        filters: {
            deep: true,
            handler(value) {
                localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(value));
            },
        },
    },
    methods: {
        handleVisibleUpdate(val) {
            this.$emit('update:modelValue', val);
        },
        handleOpen() {
            this.keyword = '';
            let saved = {};
            try {
                saved = JSON.parse(localStorage.getItem(FILTERS_STORAGE_KEY)) || {};
            } catch (err) {
                saved = {};
            }
            const nextFilters = {};
            this.library.dimensions.forEach((dim) => {
                const validIds = new Set(dim.categories.map((cat) => cat.id));
                nextFilters[dim.id] = (saved[dim.id] || []).filter(
                    (id) => validIds.has(id),
                );
            });
            this.filters = nextFilters;
        },
        thumbUrl(name) {
            return buildLoraThumbnailUrl(name, this.thumbBust);
        },
        tagChips(lora) {
            const chips = [];
            this.library.dimensions.forEach((dim) => {
                const owned = lora.tags?.[dim.id] || [];
                dim.categories.forEach((cat) => {
                    if (owned.includes(cat.id)) {
                        chips.push(cat.name);
                    }
                });
            });
            return chips;
        },
        handleSelect(name) {
            this.$emit('select', name);
            this.$emit('update:modelValue', false);
        },
        handleClear() {
            this.$emit('select', '');
            this.$emit('update:modelValue', false);
        },
    },
};
</script>

<style scoped>
.picker-filters {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}
.search-input {
  max-width: 360px;
}
.filter-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.filter-label {
  flex-shrink: 0;
  width: 72px;
  padding-top: 4px;
  font-size: 13px;
  color: #606266;
}
.picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 14px;
  max-height: 56vh;
  overflow-y: auto;
}
.lora-card {
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  transition: box-shadow 0.2s, border-color 0.2s;
}
.lora-card:hover {
  border-color: #409eff;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.18);
}
.lora-card.active {
  border-color: #409eff;
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.35);
}
.thumb-wrap {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 6px;
  overflow: hidden;
  background: #f5f7fa;
}
.thumb {
  width: 100%;
  height: 100%;
}
.thumb-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 13px;
  color: #909399;
}
.card-name {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.4;
  word-break: break-all;
  color: #303133;
}
.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
  min-height: 22px;
}
</style>
