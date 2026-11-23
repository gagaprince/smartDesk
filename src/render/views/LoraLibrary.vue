<template>
  <div class="lora-library-page">
    <el-card class="section-card">
      <template #header>
        <div class="card-header">
          <span>模型分类管理</span>
          <el-button
            type="primary"
            @click="openAddDimension"
          >
            新增维度
          </el-button>
        </div>
      </template>
      <div
        v-for="dim in library.dimensions"
        :key="dim.id"
        class="dimension-block"
      >
        <div class="dimension-head">
          <span class="dimension-name">{{ dim.name }}</span>
          <el-button
            link
            type="danger"
            size="small"
            @click="removeDimension(dim)"
          >
            删除维度
          </el-button>
        </div>
        <div class="category-row">
          <el-tag
            v-for="cat in dim.categories"
            :key="cat.id"
            closable
            class="category-tag"
            @close="removeCategory(dim, cat)"
          >
            {{ cat.name }}
          </el-tag>
          <el-input
            v-model="newCategoryNames[dim.id]"
            size="small"
            class="add-category-input"
            placeholder="新分类名称"
            @keyup.enter="addCategory(dim)"
          >
            <template #append>
              <el-button @click="addCategory(dim)">
                添加
              </el-button>
            </template>
          </el-input>
        </div>
      </div>
    </el-card>

    <el-card class="section-card">
      <template #header>
        <div class="card-header">
          <span>
            模型打标（共 {{ library.loras.length }} 个，目录外 {{ unmanagedCount }} 个）
          </span>
          <div class="header-actions">
            <el-input
              v-model="keyword"
              class="search-input"
              placeholder="搜索模型名称"
              clearable
            />
            <el-button
              :loading="loading"
              @click="loadLibrary(true)"
            >
              刷新模型列表
            </el-button>
          </div>
        </div>
      </template>
      <div class="tag-filters">
        <div
          v-for="dim in library.dimensions"
          :key="dim.id"
          class="filter-row"
        >
          <span class="filter-label">{{ dim.name }}</span>
          <el-checkbox-group
            :model-value="tagFilters[dim.id] || []"
            size="small"
            @change="(value) => handleFilterChange(dim.id, value)"
          >
            <el-checkbox-button value="__uncategorized__">
              未分类
            </el-checkbox-button>
            <el-checkbox-button
              v-for="cat in dim.categories"
              :key="cat.id"
              :value="cat.id"
            >
              {{ cat.name }}
            </el-checkbox-button>
          </el-checkbox-group>
        </div>
        <div class="filter-actions">
          <el-button
            size="small"
            @click="resetTagFilters"
          >
            重置为未分类
          </el-button>
          <el-button
            size="small"
            @click="clearTagFilters"
          >
            显示全部
          </el-button>
        </div>
      </div>
      <div
        v-loading="loading"
        class="tag-grid"
      >
        <div
          v-for="lora in filteredLoras"
          :key="lora.name"
          class="tag-card"
          :class="{ active: selectedNames.includes(lora.name) }"
          @click="toggleSelect(lora.name)"
        >
          <div class="check-badge">
            <el-icon v-if="selectedNames.includes(lora.name)">
              <Check />
            </el-icon>
          </div>
          <el-tag
            v-if="!lora.managed"
            size="small"
            type="warning"
            class="unmanaged-badge"
          >
            目录外
          </el-tag>
          <el-button
            v-else
            class="delete-badge"
            type="danger"
            :loading="deleting"
            title="删除该模型（含缩略图与标签）"
            @click.stop="deleteSingle(lora)"
          >
            <el-icon><Delete /></el-icon>
          </el-button>
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
            <template v-if="tagTexts(lora).length">
              <el-tag
                v-for="text in tagTexts(lora)"
                :key="text"
                size="small"
                type="info"
                class="tag-chip"
              >
                {{ text }}
              </el-tag>
            </template>
            <el-tag
              v-else
              size="small"
              type="warning"
            >
              未分类
            </el-tag>
          </div>
        </div>
        <el-empty
          v-if="!loading && !filteredLoras.length"
          description="没有符合筛选条件的模型"
        />
      </div>
      <div class="batch-bar">
        <span>已选 {{ selectedNames.length }} 个模型</span>
        <el-button
          type="danger"
          plain
          :loading="deleting"
          :disabled="!selectedNames.length"
          @click="batchDelete"
        >
          批量删除
        </el-button>
        <el-button
          type="primary"
          :disabled="!selectedNames.length"
          @click="openTagDialog"
        >
          批量打标
        </el-button>
      </div>
    </el-card>

    <el-card class="section-card">
      <template #header>
        <span>生图测试（千问 LoRA 文生图 turbo，固定 1:1，种子随机）</span>
      </template>
      <el-alert
        v-if="!testWorkflowReady"
        type="warning"
        :closable="false"
        show-icon
        title="未找到 qwen_lora_txt2img 工作流，生图测试不可用"
      />
      <el-form
        label-position="top"
        :disabled="generating"
      >
        <el-form-item label="提示词">
          <el-input
            v-model="prompt"
            type="textarea"
            :rows="4"
            maxlength="2000"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="LoRA 模型">
          <div class="lora-select-row">
            <el-input
              :model-value="selectedLora"
              class="lora-input"
              readonly
              placeholder="点击右侧按钮选择 LoRA"
            />
            <el-button @click="pickerVisible = true">
              选择 LoRA
            </el-button>
            <el-button
              :disabled="!selectedLora"
              @click="selectedLora = ''"
            >
              清除
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="LoRA 强度">
          <el-input-number
            v-model="strength"
            :min="-10"
            :max="10"
            :step="0.1"
            :precision="2"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :loading="generating"
            :disabled="!testWorkflowReady"
            @click="handleGenerate"
          >
            开始生图
          </el-button>
          <el-text
            v-if="busyText"
            type="info"
            class="busy-text"
          >
            {{ busyText }}
          </el-text>
        </el-form-item>
      </el-form>
      <el-alert
        v-if="currentJob && currentJob.status === 'error'"
        type="error"
        :closable="false"
        show-icon
        :title="currentJob.error || '生图失败'"
      />
      <div
        v-if="currentJob && currentJob.status === 'success' && currentJob.image_url"
        class="test-result"
      >
        <el-image
          :src="resolveImageUrl(currentJob.image_url)"
          :preview-src-list="[resolveImageUrl(currentJob.image_url)]"
          fit="contain"
          class="result-image"
        />
        <el-button
          type="primary"
          :disabled="!selectedLora"
          :loading="savingThumb"
          @click="handleSaveThumbnail"
        >
          保存为「{{ selectedLora ? loraBaseName(selectedLora) : '' }}」的缩略图
        </el-button>
      </div>
    </el-card>

    <el-dialog
      v-model="dimDialogVisible"
      title="新增维度"
      width="360px"
    >
      <el-input
        v-model="newDimensionName"
        placeholder="如：画风、适用场景"
        @keyup.enter="confirmAddDimension"
      />
      <template #footer>
        <el-button @click="dimDialogVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          @click="confirmAddDimension"
        >
          确定
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="tagDialogVisible"
      title="批量打标"
      width="520px"
    >
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="仅修改过的维度会保存；某维度勾选的分类将覆盖所选模型在该维度的标签"
      />
      <div
        v-for="dim in library.dimensions"
        :key="dim.id"
        class="batch-dim"
      >
        <div class="batch-dim-head">
          <span>{{ dim.name }}</span>
          <el-tag
            v-if="touchedDims.includes(dim.id)"
            size="small"
            type="success"
          >
            将保存
          </el-tag>
        </div>
        <el-checkbox-group
          v-model="batchForm[dim.id]"
          @change="markTouched(dim.id)"
        >
          <el-checkbox
            v-for="cat in dim.categories"
            :key="cat.id"
            :value="cat.id"
          >
            {{ cat.name }}
          </el-checkbox>
        </el-checkbox-group>
      </div>
      <template #footer>
        <el-button @click="tagDialogVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="tagSaving"
          @click="saveBatchTags"
        >
          保存
        </el-button>
      </template>
    </el-dialog>

    <LoraPickerModal
      v-model="pickerVisible"
      :library="library"
      :selected="selectedLora"
      :thumb-bust="thumbBust"
      @select="handlePickLora"
    />
  </div>
</template>

<script>
import {
    batchLoraTags,
    buildLoraThumbnailUrl,
    deleteLoras,
    fetchLoraLibrary,
    fetchWorkflows,
    invokeWorkflow,
    fetchJob,
    resolveImageUrl,
    saveLoraDimensions,
    saveLoraThumbnail,
} from '@/render/common/comfyuiApi';
import LoraPickerModal from '@/render/components/lora/LoraPickerModal.vue';

const TEST_WORKFLOW_ID = 'qwen_lora_txt2img';
const POLL_INTERVAL = 2000;

export default {
    name: 'LoraLibrary',
    components: { LoraPickerModal },
    data() {
        return {
            library: { dimensions: [], loras: [], roots: [] },
            loading: false,
            dimSaving: false,
            keyword: '',
            selectedNames: [],
            tagFilters: {},
            deleting: false,
            tagDialogVisible: false,
            tagSaving: false,
            batchForm: {},
            touchedDims: [],
            newCategoryNames: {},
            dimDialogVisible: false,
            newDimensionName: '',
            pickerVisible: false,
            selectedLora: '',
            thumbBust: 0,
            prompt: '漂亮少女，真人，姿态自然，头像感，特别特别瘦，白皙皮肤。梦核风格的前置摄像头抓拍画面，有一种抓拍的随性松弛氛围感，ins风，随手记录。画面里的少女超级漂亮，低分辨率，露出的脸和皮肤微微曝光，柔顺头发，盘发，午后的阳光洒在身上形成漂亮的光影，优美的姿势，背景是庄园式农场草原树林，充满生命力，生机勃勃。',
            strength: 1.0,
            testWorkflowReady: false,
            generating: false,
            currentJob: null,
            pollTimer: null,
            savingThumb: false,
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
                    const picked = this.tagFilters[dim.id] || [];
                    if (!picked.length) {
                        return true;
                    }
                    const owned = lora.tags?.[dim.id] || [];
                    return picked.some((id) => (
                        id === '__uncategorized__'
                            ? owned.length === 0
                            : owned.includes(id)
                    ));
                });
            });
        },
        unmanagedCount() {
            return this.library.loras.filter((lora) => !lora.managed).length;
        },
        busyText() {
            if (!this.currentJob) {
                return '';
            }
            if (this.currentJob.status === 'queued') {
                return '任务排队中…';
            }
            if (this.currentJob.status === 'running') {
                return 'ComfyUI 正在生成，请稍候…';
            }
            return '';
        },
    },
    mounted() {
        this.loadLibrary();
        this.checkTestWorkflow();
    },
    beforeUnmount() {
        this.stopPolling();
    },
    methods: {
        resolveImageUrl,
        thumbUrl(name) {
            return buildLoraThumbnailUrl(name, this.thumbBust);
        },
        async loadLibrary(force = false) {
            this.loading = true;
            try {
                this.library = await fetchLoraLibrary(force);
                this.library.dimensions.forEach((dim) => {
                    if (this.newCategoryNames[dim.id] === undefined) {
                        this.newCategoryNames[dim.id] = '';
                    }
                    if (this.tagFilters[dim.id] === undefined) {
                        this.tagFilters[dim.id] = ['__uncategorized__'];
                    }
                });
            } catch (err) {
                this.$message.error(`加载 LoRA 库失败：${err.message || err}`);
            } finally {
                this.loading = false;
            }
        },
        async checkTestWorkflow() {
            try {
                const workflows = await fetchWorkflows();
                this.testWorkflowReady = workflows.some(
                    (item) => item.workflow_id === TEST_WORKFLOW_ID,
                );
            } catch (err) {
                this.testWorkflowReady = false;
            }
        },
        async persistDimensions() {
            this.dimSaving = true;
            try {
                await saveLoraDimensions(this.library.dimensions);
                await this.loadLibrary();
                this.$message.success('分类已保存');
            } catch (err) {
                this.$message.error(`分类保存失败：${err.message || err}`);
                await this.loadLibrary();
            } finally {
                this.dimSaving = false;
            }
        },
        openAddDimension() {
            this.newDimensionName = '';
            this.dimDialogVisible = true;
        },
        async confirmAddDimension() {
            const name = this.newDimensionName.trim();
            if (!name) {
                this.$message.warning('请输入维度名称');
                return;
            }
            if (this.library.dimensions.some((dim) => dim.name === name)) {
                this.$message.warning('维度名称已存在');
                return;
            }
            this.library.dimensions.push({ id: '', name, categories: [] });
            this.dimDialogVisible = false;
            this.newDimensionName = '';
            await this.persistDimensions();
        },
        async removeDimension(dim) {
            try {
                await this.$confirm(
                    `确认删除维度「${dim.name}」？该维度下的标签关联会一并清除。`,
                    '提示',
                    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
                );
            } catch (err) {
                return;
            }
            this.library.dimensions = this.library.dimensions
                .filter((item) => item.id !== dim.id);
            await this.persistDimensions();
        },
        async addCategory(dim) {
            const name = (this.newCategoryNames[dim.id] || '').trim();
            if (!name) {
                return;
            }
            if (dim.categories.some((cat) => cat.name === name)) {
                this.$message.warning('该维度下分类名称已存在');
                return;
            }
            dim.categories.push({ id: '', name });
            this.newCategoryNames[dim.id] = '';
            await this.persistDimensions();
        },
        async removeCategory(dim, cat) {
            dim.categories = dim.categories.filter((item) => item.id !== cat.id);
            await this.persistDimensions();
        },
        toggleSelect(name) {
            if (this.selectedNames.includes(name)) {
                this.selectedNames = this.selectedNames.filter((item) => item !== name);
            } else {
                this.selectedNames = [...this.selectedNames, name];
            }
        },
        handleFilterChange(dimId, newValue) {
            // 同一维度内「未分类」与具体分类互斥: 点未分类只留未分类, 点分类自动移除未分类
            const previous = this.tagFilters[dimId] || [];
            const added = newValue.find((id) => !previous.includes(id));
            let next = [...newValue];
            if (added === '__uncategorized__') {
                next = ['__uncategorized__'];
            } else if (added) {
                next = next.filter((id) => id !== '__uncategorized__');
            }
            this.tagFilters[dimId] = next;
        },
        resetTagFilters() {
            const next = {};
            this.library.dimensions.forEach((dim) => {
                next[dim.id] = ['__uncategorized__'];
            });
            this.tagFilters = next;
        },
        clearTagFilters() {
            const next = {};
            this.library.dimensions.forEach((dim) => {
                next[dim.id] = [];
            });
            this.tagFilters = next;
        },
        async deleteSingle(lora) {
            try {
                await this.$confirm(
                    `确认删除模型「${lora.name}」？模型文件、同名缩略图和全部标签将一并删除，且不可恢复。`,
                    '删除确认',
                    {
                        type: 'warning',
                        confirmButtonText: '删除',
                        cancelButtonText: '取消',
                        confirmButtonClass: 'el-button--danger',
                    },
                );
            } catch (err) {
                return;
            }
            await this.runDelete([lora.name]);
        },
        async batchDelete() {
            const managedNames = this.selectedNames.filter((name) => {
                const lora = this.library.loras.find((item) => item.name === name);
                return lora && lora.managed;
            });
            if (!managedNames.length) {
                this.$message.warning('所选模型均不在受管目录内，无法删除');
                return;
            }
            const skipped = this.selectedNames.length - managedNames.length;
            try {
                await this.$confirm(
                    `确认删除选中的 ${managedNames.length} 个模型？模型文件、同名缩略图和全部标签将一并删除，且不可恢复。${skipped ? `另有 ${skipped} 个目录外模型会自动跳过。` : ''}`,
                    '批量删除确认',
                    {
                        type: 'warning',
                        confirmButtonText: '删除',
                        cancelButtonText: '取消',
                        confirmButtonClass: 'el-button--danger',
                    },
                );
            } catch (err) {
                return;
            }
            await this.runDelete(managedNames);
        },
        async runDelete(names) {
            this.deleting = true;
            try {
                const result = await deleteLoras(names);
                if (result.failed.length) {
                    const reasons = result.failed.map((item) => item.reason);
                    this.$message.warning(
                        `成功删除 ${result.deleted.length} 个，失败 ${result.failed.length} 个：${reasons.join('；')}`,
                    );
                } else {
                    this.$message.success(`已删除 ${result.deleted.length} 个模型`);
                }
                const deletedSet = new Set(result.deleted);
                this.selectedNames = this.selectedNames
                    .filter((name) => !deletedSet.has(name));
                await this.loadLibrary(true);
            } catch (err) {
                this.$message.error(`删除失败：${err.message || err}`);
            } finally {
                this.deleting = false;
            }
        },
        tagTexts(lora) {
            const texts = [];
            this.library.dimensions.forEach((dim) => {
                const owned = lora.tags?.[dim.id] || [];
                const names = dim.categories
                    .filter((cat) => owned.includes(cat.id))
                    .map((cat) => cat.name);
                if (names.length) {
                    texts.push(`${dim.name}：${names.join('/')}`);
                }
            });
            return texts;
        },
        openTagDialog() {
            if (!this.selectedNames.length) {
                return;
            }
            const form = {};
            this.library.dimensions.forEach((dim) => {
                form[dim.id] = [];
            });
            this.batchForm = form;
            this.touchedDims = [];
            this.tagDialogVisible = true;
        },
        markTouched(dimId) {
            if (!this.touchedDims.includes(dimId)) {
                this.touchedDims.push(dimId);
            }
        },
        async saveBatchTags() {
            if (!this.touchedDims.length) {
                this.$message.warning('请先勾选要修改的分类');
                return;
            }
            const tags = {};
            this.touchedDims.forEach((dimId) => {
                tags[dimId] = this.batchForm[dimId] || [];
            });
            const names = [...this.selectedNames];
            this.tagSaving = true;
            try {
                await batchLoraTags(names, tags);
                this.$message.success(`已为 ${names.length} 个模型保存标签`);
                this.tagDialogVisible = false;
                this.selectedNames = [];
                await this.loadLibrary();
            } catch (err) {
                this.$message.error(`批量打标失败：${err.message || err}`);
            } finally {
                this.tagSaving = false;
            }
        },
        handlePickLora(name) {
            this.selectedLora = name;
        },
        loraBaseName(name) {
            const segments = name.split(/[\\/]/).filter(Boolean);
            const fileName = segments.length ? segments[segments.length - 1] : name;
            return fileName.replace(/\.[^.]+$/, '');
        },
        stopPolling() {
            if (this.pollTimer !== null) {
                window.clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
        },
        startPolling(jobId) {
            this.stopPolling();
            this.pollTimer = window.setInterval(async () => {
                try {
                    const latest = await fetchJob(jobId);
                    this.currentJob = latest;
                    if (['success', 'error'].includes(latest.status)) {
                        this.stopPolling();
                        this.generating = false;
                        if (latest.status === 'success') {
                            this.$message.success('生图完成');
                        } else {
                            this.$message.error(latest.error || '生图失败');
                        }
                    }
                } catch (err) {
                    this.stopPolling();
                    this.generating = false;
                    this.$message.error(`任务状态查询失败：${err.message || err}`);
                }
            }, POLL_INTERVAL);
        },
        async handleGenerate() {
            if (!this.testWorkflowReady) {
                this.$message.warning('测试工作流不可用');
                return;
            }
            if (!this.prompt.trim()) {
                this.$message.warning('请先填写提示词');
                return;
            }
            if (!this.selectedLora) {
                this.$message.warning('请先选择 LoRA 模型');
                return;
            }
            this.generating = true;
            this.currentJob = null;
            try {
                const job = await invokeWorkflow(TEST_WORKFLOW_ID, {
                    prompt: this.prompt,
                    lora_enabled: true,
                    lora_name: this.selectedLora,
                    lora_strength: this.strength,
                    seed: -1,
                    aspect_ratio: '1:1 (Square)',
                });
                this.currentJob = job;
                this.startPolling(job.job_id);
            } catch (err) {
                this.generating = false;
                this.$message.error(`提交失败：${err.message || err}`);
            }
        },
        async imageUrlToPngDataUrl(url) {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const blob = await response.blob();
            const image = await createImageBitmap(blob);
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            canvas.getContext('2d').drawImage(image, 0, 0);
            if (typeof image.close === 'function') {
                image.close();
            }
            return canvas.toDataURL('image/png');
        },
        async handleSaveThumbnail() {
            if (!this.currentJob || !this.currentJob.image_url || !this.selectedLora) {
                return;
            }
            this.savingThumb = true;
            try {
                const dataUrl = await this.imageUrlToPngDataUrl(
                    resolveImageUrl(this.currentJob.image_url),
                );
                await saveLoraThumbnail(this.selectedLora, dataUrl);
                this.thumbBust += 1;
                this.$message.success('缩略图已保存到模型同目录（同名 png）');
                await this.loadLibrary();
            } catch (err) {
                this.$message.error(`缩略图保存失败：${err.message || err}`);
            } finally {
                this.savingThumb = false;
            }
        },
    },
};
</script>

<style scoped>
.lora-library-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.section-card {
  margin: 0;
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.search-input {
  width: 240px;
}
.dimension-block {
  padding: 12px 16px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}
.dimension-block + .dimension-block {
  margin-top: 12px;
}
.dimension-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.dimension-name {
  font-weight: 600;
  color: #303133;
}
.category-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.category-tag {
  cursor: default;
}
.add-category-input {
  width: 200px;
}
.tag-filters {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
  margin-bottom: 14px;
  background: #f8fafc;
  border: 1px solid #ebeef5;
  border-radius: 8px;
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
.filter-actions {
  display: flex;
  gap: 10px;
  padding-left: 82px;
}
.tag-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
  min-height: 200px;
}
.tag-card {
  position: relative;
  padding: 10px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  cursor: pointer;
  transition: box-shadow 0.2s, border-color 0.2s;
}
.tag-card:hover {
  border-color: #409eff;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.18);
}
.tag-card.active {
  border-color: #409eff;
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.35);
}
.check-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: #fff;
  background: #409eff;
  border-radius: 50%;
}
.unmanaged-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
}
.delete-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  width: 26px;
  height: 26px;
  min-height: 26px;
  padding: 0;
  border-radius: 50%;
  opacity: 0.85;
}
.delete-badge:hover {
  opacity: 1;
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
  background: #f5f7fa;
  color: #909399;
  font-size: 12px;
  width: 100%;
  height: 100%;
}
.card-name {
  margin-top: 8px;
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
  min-height: 24px;
}
.tag-chip {
  margin: 2px 4px 2px 0;
}
.batch-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 12px;
}
.lora-select-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.lora-input {
  max-width: 520px;
}
.busy-text {
  margin-left: 12px;
}
.test-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.result-image {
  max-width: 420px;
  max-height: 420px;
  border-radius: 8px;
}
.batch-dim {
  margin-top: 14px;
}
.batch-dim-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-weight: 600;
}
</style>
