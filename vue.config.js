const path = require('path');
const { defineConfig } = require('@vue/cli-service');

module.exports = defineConfig({
    transpileDependencies: true,
    configureWebpack: {
        resolve: {
            alias: {
                '@': path.resolve(__dirname, 'src'),
            },
        },
    },
    pluginOptions: {
        electronBuilder: {
            preload: 'src/preload.js',
            builderOptions: {
                appId: 'com.prince.smartdesk',
                win: {
                    target: 'nsis',
                },
                extraResources: [
                    {
                        from: 'subprojects/headcut',
                        to: 'headcut',
                        filter: [
                            '**/*',
                            '!**/__pycache__/**',
                            '!**/*.pyc',
                            '!pip-install.log',
                        ],
                    },
                    {
                        from: 'subprojects/comfyui-ctrl',
                        to: 'comfyui-ctrl',
                        filter: [
                            '**/*',
                            '!**/__pycache__/**',
                            '!**/*.pyc',
                            '!pip-install.log',
                            '!workflows/outputs/**',
                            '!workflows/backups/**',
                            '!doc/**',
                        ],
                    },
                ],
            },
        },
    },
});
