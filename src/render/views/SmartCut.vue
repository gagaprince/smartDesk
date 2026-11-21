<template>
  <div class="smart-cut-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <el-icon><MagicStick /></el-icon>
          <span>一键智能裁切（图片 / 视频 · 多部位）</span>
        </div>
      </template>
      <el-form
        label-width="140px"
        class="smart-cut-form"
      >
        <el-form-item label="素材目录">
          <el-input
            v-model="form.inputDir"
            placeholder="选择包含图片或视频的目录, 视频会按时间均分抽帧后裁切"
          >
            <template #append>
              <el-icon
                class="select-folder"
                color="#fece65"
                size="20"
                @click="selectFolder('inputDir')"
              >
                <Folder />
              </el-icon>
            </template>
          </el-input>
          <div class="output-hint">
            <el-text type="info">
              支持 jpg/png/webp 等图片与 mp4/mov/avi/mkv 等视频, 每个视频抽取 {{ form.frames }} 张均匀分布的画面
            </el-text>
          </div>
        </el-form-item>
        <el-form-item label="裁切结果输出目录">
          <el-input
            v-model="form.outputDir"
            placeholder="裁切后的正方形素材将输出到该目录"
          >
            <template #append>
              <el-icon
                class="select-folder"
                color="#fece65"
                size="20"
                @click="selectFolder('outputDir')"
              >
                <FolderOpened />
              </el-icon>
            </template>
          </el-input>
          <div class="output-hint">
            <el-text type="info">
              实际输出路径（输出目录 \ 当前日期 \ 素材目录同名子文件夹）：{{ resultDir || '请先选择目录' }}
            </el-text>
          </div>
        </el-form-item>
        <el-form-item label="递归处理子目录">
          <el-switch v-model="form.recursive" />
          <el-text
            class="hint-text"
            type="info"
          >
            开启后会扫描输入目录下所有子文件夹中的图片与视频
          </el-text>
        </el-form-item>
        <el-form-item label="视频抽帧数量 N">
          <el-input-number
            v-model="form.frames"
            :min="1"
            :max="30"
            :step="1"
          />
          <el-text
            class="hint-text"
            type="info"
          >
            每个视频按时间平分 N 段, 取每段中点的画面, 默认 5
          </el-text>
        </el-form-item>
        <el-form-item label="裁切部位">
          <el-checkbox-group v-model="form.parts">
            <el-checkbox
              v-for="part in partOptions"
              :key="part.value"
              :label="part.value"
            >
              {{ part.label }}
            </el-checkbox>
          </el-checkbox-group>
          <el-text
            class="hint-text"
            type="info"
          >
            提示词未命中部位关键词时按此勾选执行, 手/脚被遮挡会自动跳过
          </el-text>
        </el-form-item>
        <el-form-item label="提示词">
          <el-input
            v-model="form.prompt"
            type="textarea"
            :rows="2"
            placeholder="可选, 如: 裁切模特的头像、胸部和手部特写 (中英文关键词均可, 命中后优先于上方勾选)"
          />
        </el-form-item>
        <el-form-item label="输出尺寸（像素）">
          <el-input-number
            v-model="form.size"
            :min="64"
            :max="4096"
            :step="64"
          />
          <el-text
            class="hint-text"
            type="info"
          >
            输出正方形边长, LoRA 素材常用 1024
          </el-text>
        </el-form-item>
        <el-form-item label="裁切比例">
          <el-input-number
            v-model="form.scale"
            :min="1.2"
            :max="6"
            :step="0.1"
          />
          <el-text
            class="hint-text"
            type="info"
          >
            头/胸/腿/手/脚各部位统一生效, 裁切边长 = 主体检测框 × 该倍数, 数值越大画面越宽松, 默认 2.6
          </el-text>
        </el-form-item>
        <el-form-item label="AI 部位识别">
          <el-switch v-model="form.aiSeg" />
          <el-text
            class="hint-text"
            type="info"
          >
            胸/腿/手/脚改用 SegFormer 服装解析模型做像素级识别, 定位更精准; 首次使用自动下载约 110MB 模型, 识别失败自动回退关键点方案, 头部仍走人脸检测不受影响
          </el-text>
        </el-form-item>
        <el-collapse class="advanced-collapse">
          <el-collapse-item title="高级检测参数">
            <el-form-item label="人脸置信度">
              <el-input-number
                v-model="form.confidence"
                :min="0.1"
                :max="0.95"
                :step="0.05"
              />
              <el-text
                class="hint-text"
                type="info"
              >
                头部人脸检测阈值, 漏检时调低
              </el-text>
            </el-form-item>
            <el-form-item label="人体置信度">
              <el-input-number
                v-model="form.poseConfidence"
                :min="0.1"
                :max="0.95"
                :step="0.05"
              />
              <el-text
                class="hint-text"
                type="info"
              >
                姿态检测阈值, 误检时调高
              </el-text>
            </el-form-item>
            <el-form-item label="关键点可见度">
              <el-input-number
                v-model="form.kptConf"
                :min="0.1"
                :max="0.95"
                :step="0.05"
              />
              <el-text
                class="hint-text"
                type="info"
              >
                低于该值的手/脚关键点视为遮挡并跳过, 默认 0.5
              </el-text>
            </el-form-item>
          </el-collapse-item>
        </el-collapse>
        <el-form-item label="识别区域调试图">
          <el-switch v-model="form.saveDebug" />
          <el-text
            class="hint-text"
            type="info"
          >
            开启后每个处理单元在输出目录的 _debug 子文件夹保存标注图, 画出人体框、关键点骨架与各部位裁切框, 方便核对识别位置
          </el-text>
        </el-form-item>
        <el-form-item label="去除背景">
          <el-switch v-model="form.removeBg" />
          <el-text
            class="hint-text"
            type="info"
          >
            裁切后抠除背景, 需 headcut 安装可选依赖; 首次使用自动下载分割模型
          </el-text>
        </el-form-item>
        <template v-if="form.removeBg">
          <el-form-item label="分割模型">
            <el-select
              v-model="form.bgModel"
              style="width: 360px"
            >
              <el-option
                label="人像专用 u2net_human_seg（默认, 效果最好, 约176MB）"
                value="u2net_human_seg"
              />
              <el-option
                label="轻量快速 silueta（约43MB, 效果接近）"
                value="silueta"
              />
              <el-option
                label="通用高精度 isnet-general-use（约176MB）"
                value="isnet-general-use"
              />
              <el-option
                label="通用分割 u2net（约176MB）"
                value="u2net"
              />
              <el-option
                label="动漫插画 isnet-anime（约176MB）"
                value="isnet-anime"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="背景方式">
            <el-radio-group v-model="form.bgMode">
              <el-radio label="transparent">
                透明底（自动输出 PNG）
              </el-radio>
              <el-radio label="solid">
                纯色底
              </el-radio>
            </el-radio-group>
            <el-color-picker
              v-if="form.bgMode === 'solid'"
              v-model="form.bgColor"
              class="bg-color-picker"
            />
          </el-form-item>
        </template>
        <el-form-item label="headcut 项目目录">
          <el-input
            v-model="form.headcutHome"
            placeholder="留空自动查找 (内置 subprojects/headcut 子项目)"
          >
            <template #append>
              <el-icon
                class="select-folder"
                color="#fece65"
                size="20"
                @click="selectFolder('headcutHome')"
              >
                <Folder />
              </el-icon>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :loading="running"
            @click="startCut"
          >
            一键智能裁切
          </el-button>
          <el-button
            type="danger"
            :disabled="!running"
            @click="stopCut"
          >
            停止
          </el-button>
          <el-button
            :disabled="!form.outputDir"
            @click="openOutput"
          >
            打开输出目录
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="progress-card">
      <template #header>
        <div class="card-header">
          <span>裁切进度</span>
          <el-text
            v-if="stats.total"
            type="info"
          >
            共 {{ stats.total }} 个单元 / 已裁切 {{ stats.cropped }} / 无目标 {{ stats.noTarget }} / 失败 {{ stats.failed }}
          </el-text>
        </div>
      </template>
      <el-progress
        :percentage="percentage"
        :status="running ? '' : 'success'"
      />
    </el-card>

    <el-card class="result-card">
      <template #header>
        <div class="card-header">
          <span>裁切结果（{{ resultImages.length }} 张）</span>
          <div class="header-actions">
            <el-checkbox
              :model-value="allChecked"
              :indeterminate="indeterminate"
              @change="toggleAll"
            >
              全选
            </el-checkbox>
            <el-button
              size="small"
              type="danger"
              plain
              :disabled="!selectedNames.length"
              @click="batchDelete"
            >
              删除选中 ({{ selectedNames.length }})
            </el-button>
            <el-button
              size="small"
              @click="loadResultImages"
            >
              刷新
            </el-button>
          </div>
        </div>
      </template>
      <el-empty
        v-if="!resultImages.length"
        description="还没有裁切结果, 选择目录后点击「一键智能裁切」"
      />
      <div
        v-else
        class="result-grid"
      >
        <div
          v-for="item in resultImages"
          :key="item.path"
          class="result-item"
        >
          <el-checkbox
            class="result-check"
            :model-value="selectedNames.includes(item.name)"
            @change="(checked) => toggleSelect(item.name, checked)"
          />
          <el-image
            :src="item.thumb"
            :class="{ 'thumb-transparent': item.name.toLowerCase().endsWith('.png') }"
            fit="cover"
            class="result-thumb"
            @click="previewImage(item)"
          >
            <template #placeholder>
              <div class="thumb-loading">
                加载中...
              </div>
            </template>
          </el-image>
          <el-popconfirm
            title="确定从输出目录删除这张图片?"
            confirm-button-text="删除"
            cancel-button-text="取消"
            confirm-button-type="danger"
            @confirm="deleteImage(item)"
          >
            <template #reference>
              <el-icon class="result-del">
                <Delete />
              </el-icon>
            </template>
          </el-popconfirm>
          <div class="result-meta">
            <span
              class="result-name"
              :title="item.name"
            >
              {{ item.name }}
            </span>
            <span class="result-size">{{ formatSize(item.size) }}</span>
          </div>
        </div>
      </div>
    </el-card>

    <el-image-viewer
      v-if="viewerVisible"
      :url-list="[viewerUrl]"
      @close="viewerVisible = false"
    />
  </div>
</template>

<script>
import {
    selectDirectory,
    openDirectory,
    runSmartCut,
    stopSmartCut,
    listSmartCutImages,
    readSmartCutImage,
    deleteSmartCutFile,
} from '@/render/common/ipcUtil';
import { RenderReceiveEvents } from '@/common/eventConst';

const STORAGE_KEY = 'smart-cut-form';

const partOptions = [
    { value: 'head', label: '头部' },
    { value: 'chest', label: '胸部' },
    { value: 'legs', label: '腿部' },
    { value: 'hand', label: '手部' },
    { value: 'foot', label: '脚部' },
];

const defaultForm = () => ({
    inputDir: '',
    outputDir: '',
    headcutHome: '',
    recursive: true,
    frames: 5,
    parts: ['head'],
    prompt: '',
    size: 1024,
    scale: 2.6,
    aiSeg: true,
    confidence: 0.6,
    poseConfidence: 0.4,
    kptConf: 0.5,
    saveDebug: false,
    removeBg: false,
    bgModel: 'u2net_human_seg',
    bgMode: 'transparent',
    bgColor: '#FFFFFF',
});

export default {
    data() {
        return {
            partOptions,
            form: defaultForm(),
            running: false,
            percentage: 0,
            stats: {
                total: 0,
                cropped: 0,
                noTarget: 0,
                failed: 0,
            },
            resultImages: [],
            selectedNames: [],
            viewerVisible: false,
            viewerUrl: '',
        };
    },
    computed: {
        // 实际输出目录 = 配置的输出目录 + 当前日期 + 素材目录的最后一级目录名
        resultDir() {
            if (!this.form.outputDir) return '';
            const normalizedInput = (this.form.inputDir || '').replace(/[\\/]+$/, '');
            const segments = normalizedInput.split(/[\\/]/).filter(Boolean);
            const inputBase = segments.length ? segments[segments.length - 1] : '';
            const outputBase = this.form.outputDir.replace(/[\\/]+$/, '');
            const dateBase = `${outputBase}\\${this.formatDate(new Date())}`;
            return inputBase ? `${dateBase}\\${inputBase}` : dateBase;
        },
        allChecked() {
            return this.resultImages.length > 0
                && this.selectedNames.length === this.resultImages.length;
        },
        indeterminate() {
            return this.selectedNames.length > 0
                && this.selectedNames.length < this.resultImages.length;
        },
    },
    watch: {
        resultDir(dir) {
            if (dir) {
                this.loadResultImages();
            } else {
                this.resultImages = [];
                this.selectedNames = [];
            }
        },
    },
    mounted() {
        this.loadForm();
        window.ipcRenderer.on(RenderReceiveEvents.SMART_CUT_PROGRESS, this.onProgress);
        if (this.resultDir) {
            this.loadResultImages();
        }
    },
    beforeUnmount() {
        window.ipcRenderer.removeListener(
            RenderReceiveEvents.SMART_CUT_PROGRESS,
            this.onProgress,
        );
    },
    methods: {
        loadForm() {
            try {
                const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
                if (saved) {
                    this.form = { ...defaultForm(), ...saved };
                    if (!Array.isArray(this.form.parts)) {
                        this.form.parts = ['head'];
                    }
                }
            } catch (err) {
                console.error('读取智能裁切配置失败', err);
            }
        },
        saveForm() {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.form));
        },
        async selectFolder(key) {
            const ret = await selectDirectory(this.form[key]);
            if (ret && !ret.canceled && ret.filePaths && ret.filePaths[0]) {
                this.form[key] = ret.filePaths[0];
                this.saveForm();
            }
        },
        resetProgress() {
            this.percentage = 0;
            this.stats = {
                total: 0,
                cropped: 0,
                noTarget: 0,
                failed: 0,
            };
        },
        async startCut() {
            if (!this.form.inputDir) {
                this.$message.warning('请先选择素材目录');
                return;
            }
            if (!this.form.outputDir) {
                this.$message.warning('请选择裁切结果输出目录');
                return;
            }
            if (!this.form.prompt && !this.form.parts.length) {
                this.$message.warning('请至少勾选一个裁切部位, 或填写带部位关键词的提示词');
                return;
            }
            this.saveForm();
            this.resetProgress();
            this.running = true;
            try {
                // 深拷贝去掉 Vue 响应式 Proxy, 否则 IPC 结构化克隆会报
                // "An object could not be cloned" (parts 数组是嵌套引用类型)
                const options = JSON.parse(JSON.stringify(this.form));
                options.outputDir = this.resultDir;
                if (options.removeBg && options.bgMode === 'solid') {
                    options.bgColor = this.hexToRgb(options.bgColor);
                } else {
                    options.bgColor = '';
                }
                const result = await runSmartCut(options);
                if (result && result.success === false && result.message) {
                    this.$message.error(result.message);
                }
            } catch (err) {
                this.$message.error(`智能裁切任务异常: ${err.message || err}`);
            } finally {
                this.running = false;
                await this.loadResultImages();
            }
        },
        async stopCut() {
            const ret = await stopSmartCut();
            if (ret && ret.message) {
                this.$message.warning(ret.message);
            }
        },
        async openOutput() {
            await openDirectory(this.resultDir);
        },
        async loadResultImages() {
            if (!this.resultDir) {
                this.resultImages = [];
                return;
            }
            const ret = await listSmartCutImages(this.resultDir);
            if (ret && ret.success) {
                this.resultImages = ret.images;
                this.selectedNames = this.selectedNames.filter((name) => this.resultImages
                    .some((item) => item.name === name));
            } else if (ret && ret.message && !ret.message.includes('不存在')) {
                this.$message.warning(ret.message);
            }
        },
        toggleSelect(name, checked) {
            if (checked) {
                if (!this.selectedNames.includes(name)) {
                    this.selectedNames.push(name);
                }
            } else {
                this.selectedNames = this.selectedNames.filter((item) => item !== name);
            }
        },
        toggleAll(checked) {
            this.selectedNames = checked ? this.resultImages.map((item) => item.name) : [];
        },
        async previewImage(item) {
            const ret = await readSmartCutImage(item.path, this.resultDir);
            if (ret && ret.success) {
                this.viewerUrl = ret.url;
                this.viewerVisible = true;
            } else {
                this.$message.error(ret && ret.message ? ret.message : '图片读取失败');
            }
        },
        async deleteImage(item) {
            const ret = await deleteSmartCutFile(item.path, this.resultDir);
            if (ret && ret.success) {
                this.resultImages = this.resultImages.filter((img) => img.path !== item.path);
                this.selectedNames = this.selectedNames.filter((name) => name !== item.name);
            } else {
                this.$message.error(ret && ret.message ? ret.message : '删除失败');
            }
        },
        async batchDelete() {
            const targets = this.resultImages.filter((item) => this.selectedNames
                .includes(item.name));
            const results = await Promise.all(targets.map((item) => deleteSmartCutFile(
                item.path,
                this.resultDir,
            )));
            const deletedPaths = targets
                .filter((_, index) => results[index] && results[index].success)
                .map((item) => item.path);
            const failed = results.filter((ret) => !ret || !ret.success).length;
            this.resultImages = this.resultImages
                .filter((item) => !deletedPaths.includes(item.path));
            this.selectedNames = [];
            if (failed) {
                this.$message.warning(`成功删除 ${deletedPaths.length} 张, ${failed.length} 张失败`);
            } else {
                this.$message.success(`已删除 ${deletedPaths.length} 张图片`);
            }
        },
        formatSize(bytes) {
            if (!bytes) return '';
            if (bytes < 1024) return `${bytes} B`;
            if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
            return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        },
        formatDate(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        },
        hexToRgb(hex) {
            const matched = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
            if (!matched) return '';
            return matched.slice(1).map((item) => parseInt(item, 16)).join(',');
        },
        onProgress(payload) {
            if (!payload) return;
            if (typeof payload.percentage === 'number') {
                this.percentage = payload.percentage;
            }
            if (payload.stage === 'done') {
                this.percentage = 100;
                this.loadResultImages();
                if (payload.summary) {
                    this.$message.success(`智能裁切完成: ${payload.summary}`);
                }
            }
            if (typeof payload.total === 'number') {
                this.stats = {
                    total: payload.total || this.stats.total,
                    cropped: payload.cropped || 0,
                    noTarget: payload.noTarget || 0,
                    failed: payload.failed || 0,
                };
            }
        },
    },
};
</script>

<style lang="scss" scoped>
.smart-cut-container {
    .card-header {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: space-between;
    }
    .hint-text {
        margin-left: 12px;
        font-size: 12px;
    }
    .output-hint {
        width: 100%;
        margin-top: 4px;
        font-size: 12px;
        line-height: 1.4;
    }
    .select-folder {
        cursor: pointer;
    }
    .advanced-collapse {
        width: 100%;
        margin-bottom: 18px;
    }
    .progress-card {
        margin-top: 20px;
    }
    .result-card {
        margin-top: 20px;
    }
    .header-actions {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .result-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 16px;
    }
    .result-item {
        position: relative;
        border: 1px solid #ebeef5;
        border-radius: 8px;
        overflow: hidden;
        background: #fff;
        transition: box-shadow 0.2s;
        &:hover {
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
        }
    }
    .result-thumb {
        width: 100%;
        height: 180px;
        display: block;
        cursor: zoom-in;
        background: #f5f7fa;
    }
    .thumb-transparent {
        background-image:
            linear-gradient(45deg, #dcdfe6 25%, transparent 25%),
            linear-gradient(-45deg, #dcdfe6 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #dcdfe6 75%),
            linear-gradient(-45deg, transparent 75%, #dcdfe6 75%);
        background-size: 16px 16px;
        background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    }
    .bg-color-picker {
        margin-left: 12px;
    }
    .thumb-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: #909399;
        font-size: 12px;
    }
    .result-check {
        position: absolute;
        top: 6px;
        left: 6px;
        z-index: 2;
        padding: 2px 6px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.85);
    }
    .result-del {
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 2;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.55);
        color: #fff;
        cursor: pointer;
        &:hover {
            background: #f56c6c;
        }
    }
    .result-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        font-size: 12px;
        color: #606266;
    }
    .result-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .result-size {
        flex-shrink: 0;
        color: #909399;
    }
}
</style>
