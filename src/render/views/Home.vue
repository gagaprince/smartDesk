<template>
  <div class="container">
    <el-container>
      <el-header class="header">
        SmartDesk 智能工作台
      </el-header>
      <el-container>
        <el-aside width="220px">
          <el-menu
            :default-active="activePath"
            class="menu"
            router
          >
            <template
              v-for="item in menuConfig"
              :key="item.group || item.path"
            >
              <el-sub-menu
                v-if="item.children"
                :index="item.group"
              >
                <template #title>
                  <el-icon><component :is="item.icon" /></el-icon>
                  <span>{{ item.group }}</span>
                </template>
                <el-menu-item
                  v-for="child in item.children"
                  :key="child.path"
                  :index="child.path"
                >
                  <el-icon><component :is="child.icon" /></el-icon>
                  <span>{{ child.title }}</span>
                </el-menu-item>
              </el-sub-menu>
              <el-menu-item
                v-else
                :index="item.path"
              >
                <el-icon><component :is="item.icon" /></el-icon>
                <span>{{ item.title }}</span>
              </el-menu-item>
            </template>
          </el-menu>
        </el-aside>
        <el-main class="main-area">
          <el-tabs
            v-model="activePath"
            type="card"
            class="tab-bar"
            @tab-click="onTabClick"
            @tab-remove="onTabRemove"
          >
            <el-tab-pane
              v-for="tab in tabState.tabs"
              :key="tab.path"
              :label="tab.title"
              :name="tab.path"
              :closable="tab.closable"
            >
              <template #label>
                <span class="tab-label">
                  <el-icon class="tab-icon"><component :is="tab.icon" /></el-icon>
                  {{ tab.title }}
                </span>
              </template>
            </el-tab-pane>
          </el-tabs>
          <div class="tab-content">
            <router-view v-slot="{ Component }">
              <keep-alive>
                <component :is="Component" />
              </keep-alive>
            </router-view>
          </div>
        </el-main>
      </el-container>
    </el-container>
  </div>
</template>

<script>
import {
    menuConfig, tabState, openTab, closeTab,
} from '@/render/common/tabStore';

export default {
    name: 'Home',
    data() {
        return {
            menuConfig,
            tabState,
            activePath: '/dashboard',
        };
    },
    watch: {
        $route(to) {
            openTab(to.path);
            this.activePath = to.path;
        },
    },
    mounted() {
        openTab(this.$route.path);
        this.activePath = this.$route.path;
    },
    methods: {
        onTabClick(pane) {
            if (pane.paneName && pane.paneName !== this.$route.path) {
                this.$router.push(pane.paneName);
            }
        },
        onTabRemove(path) {
            const nextPath = closeTab(path);
            if (nextPath && nextPath !== this.$route.path) {
                this.$router.push(nextPath);
            }
        },
    },
};
</script>

<style lang="scss">
.container {
  height: 100vh;
}
.header {
  display: flex;
  align-items: center;
  font-size: 18px;
  font-weight: 600;
  color: #fff;
  background-color: #409eff;
}
.menu {
  height: 100%;
}
.main-area {
  display: flex;
  flex-direction: column;
  padding: 0 16px 16px;
  background-color: #f5f7fa;
}
.tab-bar {
  margin-top: 8px;
}
.tab-bar .el-tabs__header {
  margin-bottom: 8px;
}
.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.tab-icon {
  font-size: 14px;
}
.tab-content {
  flex: 1;
  overflow: auto;
  padding: 16px;
  background-color: #fff;
  border-radius: 4px;
}
</style>
