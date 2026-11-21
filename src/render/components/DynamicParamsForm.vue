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
      <div
        v-else-if="isLoraParam(param)"
        class="lora-field"
      >
        <el-image
          v-if="selectedLoraThumb(param.key)"
          :src="selectedLoraThumb(param.key)"
          fit="cover"
          class="lora-field-thumb"
        />
        <el-input
          :model-value="stringValue(param.key)"
          class="lora-field-input"
          readonly
          placeholder="点击右侧按钮选择 LoRA"
        />
        <el-button
          :loading="loraLoading"
          @click="openLoraPicker(param)"
        >
          选择 LoRA
        </el-button>
        <el-button
          :loading="loraLoading"
          title="重新拉取模型与缩略图"
          @click="refreshLoraLibrary"
        >
          <el-icon><Refresh /></el-icon>
        </el-button>
        <el-button
          :disabled="!stringValue(param.key)"
          @click="emitChange(param.key, null)"
        >
          清除
        </el-button>
      </div>
      <div
        v-else-if="param.type === 'enum'"
        class="enum-field"
      >
        <el-select
          :model-value="enumValue(param)"
          :loading="!!enumLoading[param.enum_source]"
          filterable
          clearable
          class="enum-select"
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
        <el-button
          v-if="param.enum_source"
          class="enum-refresh"
          :loading="!!enumLoading[param.enum_source]"
          title="重新拉取最新可选项（如新放入的 LoRA 模型）"
          @click="refreshEnum(param)"
        >
          <el-icon><Refresh /></el-icon>
        </el-button>
      </div>
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
      <div
        v-else-if="param.type === 'image'"
        class="image-param"
      >
        <el-upload
          :ref="(el) => registerUploadRef(param.key, el)"
          :show-file-list="false"
          :auto-upload="false"
          accept="image/*"
          :on-change="(file) => handleImageChange(param.key, file)"
        >
          <el-button>
            <el-icon><UploadFilled /></el-icon>
            <span>选择图片</span>
          </el-button>
        </el-upload>
        <div
          v-if="hasImageValue(param.key)"
          class="image-preview"
        >
          <el-image
            v-if="isDataUrl(param.key)"
            :src="stringValue(param.key)"
            fit="contain"
            :preview-src-list="[stringValue(param.key)]"
            class="image-thumb"
          />
          <el-tag
            v-else
            size="small"
            type="info"
          >
            {{ stringValue(param.key) }}
          </el-tag>
          <el-button
            link
            type="danger"
            size="small"
            @click="clearImage(param.key)"
          >
            清除
          </el-button>
        </div>
        <div class="param-key-hint">
          本地选图会自动转 base64 提交；接口也支持 data URL、纯 base64 或已上传文件名
        </div>
      </div>
      <div
        v-else-if="param.type === 'image_list'"
        class="image-list-param"
      >
        <el-upload
          :ref="(el) => registerUploadRef(param.key, el)"
          :show-file-list="false"
          :auto-upload="false"
          accept="image/*"
          multiple
          :on-change="(file) => handleImageListChange(param.key, file, imageListMax(param))"
        >
          <el-button>
            <el-icon><UploadFilled /></el-icon>
            <span>添加参考图（可多选）</span>
          </el-button>
        </el-upload>
        <div
          v-for="(item, index) in imageListValue(param.key)"
          :key="index"
          class="image-list-item"
        >
          <el-tag
            size="small"
            type="info"
          >
            第 {{ index + 1 }} 张
          </el-tag>
          <el-image
            :src="item"
            fit="cover"
            :preview-src-list="imageListValue(param.key)"
            class="image-list-thumb"
          />
          <el-button-group>
            <el-button
              size="small"
              :disabled="index === 0"
              @click="moveImageListItem(param.key, index, -1)"
            >
              上移
            </el-button>
            <el-button
              size="small"
              :disabled="index === imageListValue(param.key).length - 1"
              @click="moveImageListItem(param.key, index, 1)"
            >
              下移
            </el-button>
            <el-button
              size="small"
              type="danger"
              @click="removeImageListItem(param.key, index)"
            >
              移除
            </el-button>
          </el-button-group>
        </div>
        <div class="param-key-hint">
          按顺序作为参考图 1~N 提交{{ imageListMax(param.key) ? `，最多 ${imageListMax(param.key)} 张` : ''
          }}；参数 key：{{ param.key }}
        </div>
      </div>
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
  <LoraPickerModal
    v-if="loraLibrary"
    v-model="loraPickerVisible"
    :library="loraLibrary"
    :selected="loraPickerValue"
    :thumb-bust="thumbBust"
    @select="handleLoraPick"
  />
</template>

<script>
import {
    buildLoraThumbnailUrl,
    fetchEnumOptions,
    fetchLoraLibrary,
} from '@/render/common/comfyuiApi';
import LoraPickerModal from '@/render/components/lora/LoraPickerModal.vue';

const LORA_ENUM_SOURCE = 'comfyui_loras';

export default {
    name: 'DynamicParamsForm',
    components: { LoraPickerModal },
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
            uploadRefs: {},
            loraLibrary: null,
            loraLoading: false,
            loraPickerVisible: false,
            loraPickerKey: '',
            thumbBust: 0,
        };
    },
    computed: {
        loraPickerValue() {
            const value = this.values[this.loraPickerKey];
            return value === undefined || value === null ? '' : String(value);
        },
    },
    watch: {
        params: {
            immediate: true,
            handler() {
                this.loadEnumOptions();
                this.ensureLoraLibrary();
            },
        },
    },
    methods: {
        isLoraParam(param) {
            return param.type === 'enum' && param.enum_source === LORA_ENUM_SOURCE;
        },
        async ensureLoraLibrary(force = false) {
            const hasLoraParam = this.params.some((param) => this.isLoraParam(param));
            if (!hasLoraParam || this.loraLoading || (this.loraLibrary && !force)) {
                return;
            }
            this.loraLoading = true;
            try {
                this.loraLibrary = await fetchLoraLibrary(force);
            } catch (err) {
                this.$message.error(`LoRA 列表加载失败：${err.message || err}`);
            } finally {
                this.loraLoading = false;
            }
        },
        async openLoraPicker(param) {
            this.loraPickerKey = param.key;
            if (!this.loraLibrary) {
                await this.ensureLoraLibrary();
            }
            if (this.loraLibrary) {
                this.loraPickerVisible = true;
            }
        },
        async refreshLoraLibrary() {
            await this.ensureLoraLibrary(true);
            if (this.loraLibrary) {
                this.thumbBust += 1;
                this.$message.success(
                    `LoRA 列表已刷新，共 ${this.loraLibrary.loras.length} 个模型`,
                );
            }
        },
        handleLoraPick(name) {
            if (!this.loraPickerKey) {
                return;
            }
            this.emitChange(this.loraPickerKey, name === '' ? null : name);
        },
        selectedLoraThumb(key) {
            const value = this.values[key];
            if (!value || !this.loraLibrary) {
                return '';
            }
            const entry = this.loraLibrary.loras.find((lora) => lora.name === value);
            return entry && entry.thumbnail_ready
                ? buildLoraThumbnailUrl(value, this.thumbBust)
                : '';
        },
        async loadEnumOptions() {
            const sources = [...new Set(
                this.params
                    .map((param) => param.enum_source)
                    .filter(Boolean),
            )].filter((source) => source !== LORA_ENUM_SOURCE).filter(
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
        async refreshEnum(param) {
            const source = param.enum_source;
            if (!source || this.enumLoading[source]) {
                return;
            }
            this.enumLoading[source] = true;
            try {
                const result = await fetchEnumOptions(source, true);
                this.enumCache[source] = result.options;
                this.$message.success(`刷新成功，共 ${result.options.length} 个可选项`);
            } catch (err) {
                this.$message.error(`刷新失败：${err.message || err}`);
            } finally {
                this.enumLoading[source] = false;
            }
        },
        emitChange(key, value) {
            this.$emit('change', key, value);
        },
        handleImageChange(key, uploadFile) {
            const file = uploadFile.raw;
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => this.emitChange(key, reader.result);
            reader.onerror = () => this.$message.error('图片读取失败');
            reader.readAsDataURL(file);
            // 上传列表不展示, 读完即清空内部文件列表, 否则 limit/重复选择会被拦截
            this.uploadRefs[key]?.clearFiles();
        },
        registerUploadRef(key, el) {
            if (el) {
                this.uploadRefs[key] = el;
            } else {
                delete this.uploadRefs[key];
            }
        },
        clearImage(key) {
            this.emitChange(key, null);
            this.uploadRefs[key]?.clearFiles();
        },
        handleImageListChange(key, uploadFile, maxImages) {
            const file = uploadFile.raw;
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                const current = Array.isArray(this.values[key])
                    ? [...this.values[key]]
                    : [];
                if (maxImages && current.length >= maxImages) {
                    this.$message.warning(`该参数最多支持 ${maxImages} 张参考图`);
                    return;
                }
                current.push(reader.result);
                this.emitChange(key, current);
            };
            reader.onerror = () => this.$message.error('图片读取失败');
            reader.readAsDataURL(file);
            this.uploadRefs[key]?.clearFiles();
        },
        imageListValue(key) {
            return Array.isArray(this.values[key]) ? this.values[key] : [];
        },
        imageListMax(param) {
            return Array.isArray(param.image_nodes) ? param.image_nodes.length : 0;
        },
        removeImageListItem(key, index) {
            const current = [...this.imageListValue(key)];
            current.splice(index, 1);
            this.emitChange(key, current);
        },
        moveImageListItem(key, index, offset) {
            const current = [...this.imageListValue(key)];
            const target = index + offset;
            if (target < 0 || target >= current.length) return;
            const [item] = current.splice(index, 1);
            current.splice(target, 0, item);
            this.emitChange(key, current);
        },
        hasImageValue(key) {
            const value = this.values[key];
            return value !== undefined && value !== null
                && String(value).trim() !== '';
        },
        isDataUrl(key) {
            return String(this.values[key] || '').startsWith('data:');
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
.image-param {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.enum-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.enum-select {
  width: 100%;
  max-width: 480px;
}
.enum-refresh {
  flex-shrink: 0;
}
.lora-field {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.lora-field-thumb {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 6px;
}
.lora-field-input {
  flex: 1;
  min-width: 0;
  max-width: 480px;
}
.image-preview {
  display: flex;
  align-items: center;
  gap: 10px;
}
.image-thumb {
  width: 120px;
  height: 120px;
  border-radius: 6px;
  border: 1px solid #dcdfe6;
}
.image-list-param {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.image-list-item {
  display: flex;
  align-items: center;
  gap: 10px;
}
.image-list-thumb {
  width: 72px;
  height: 72px;
  border-radius: 6px;
  border: 1px solid #dcdfe6;
}
</style>
