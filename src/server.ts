import { resolve } from 'path'
import * as vite from 'vite'
import { createVuePlugin } from 'vite-plugin-vue2'
import consola from 'consola'
import { join } from 'upath'
import type { RollupWatcher } from 'rollup'
import { ViteBuildContext, ViteOptions } from './types'
import { wpfs } from './utils/wpfs'
import { jsxPlugin } from './plugins/jsx'

export async function buildServer (ctx: ViteBuildContext) {
  // Workaround to disable HMR
  const _env = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  const vuePlugin = createVuePlugin(ctx.config.vue)
  process.env.NODE_ENV = _env

  const alias = {}
  for (const p of ctx.builder.plugins) {
    alias[p.name] = p.mode === 'client'
      ? `defaultexport:${resolve(ctx.nuxt.options.buildDir, 'empty.js')}`
      : `defaultexport:${p.src}`
  }

  const serverConfig: vite.InlineConfig = vite.mergeConfig(ctx.config, {
    define: {
      'process.server': true,
      'process.client': false,
      'process.static': false,
      'typeof window': '"undefined"',
      'typeof document': '"undefined"',
      'typeof navigator': '"undefined"',
      'typeof location': '"undefined"',
      'typeof XMLHttpRequest': '"undefined"'
    },
    cacheDir: resolve(ctx.nuxt.options.rootDir, 'node_modules/.cache/vite/server'),
    resolve: {
      alias
    },
    ssr: {
      external: [
        'axios'
      ],
      noExternal: [
        ...ctx.nuxt.options.build.transpile.filter(i => typeof i === 'string')
      ]
    },
    build: {
      outDir: resolve(ctx.nuxt.options.buildDir, 'dist/server'),
      assetsDir: ctx.nuxt.options.app.assetsPath.replace(/^\/|\/$/, ''),
      ssr: true,
      rollupOptions: {
        input: resolve(ctx.nuxt.options.buildDir, 'server.js'),
        onwarn (warning, rollupWarn) {
          if (!['UNUSED_EXTERNAL_IMPORT'].includes(warning.code)) {
            rollupWarn(warning)
          }
        }
      }
    },
    plugins: [
      jsxPlugin(),
      vuePlugin
    ]
  } as ViteOptions)

  await ctx.nuxt.callHook('vite:extendConfig', serverConfig, { isClient: false, isServer: true })

  const onBuild = () => ctx.nuxt.callHook('build:resources', wpfs)

  if (!ctx.nuxt.options.dev) {
    const start = Date.now()
    consola.info('Building server...')
    await vite.build(serverConfig)
    await onBuild()
    consola.success(`Server built in ${Date.now() - start}ms`)
  } else {
    const watcher = await vite.build({
      ...serverConfig,
      build: {
        ...serverConfig.build,
        watch: {
          include: [
            join(ctx.nuxt.options.buildDir, '**/*'),
            join(ctx.nuxt.options.srcDir, '**/*'),
            join(ctx.nuxt.options.rootDir, '**/*')
          ],
          exclude: [
            '**/dist/server/**'
          ]
        }
      }
    }) as RollupWatcher

    let start = Date.now()
    watcher.on('event', async (event) => {
      if (event.code === 'BUNDLE_START') {
        start = Date.now()
      } else if (event.code === 'BUNDLE_END') {
        await onBuild()
        consola.info(`Server rebuilt in ${Date.now() - start}ms`)
      } else if (event.code === 'ERROR') {
        consola.error(event.error)
      }
    })

    ctx.nuxt.hook('close', () => watcher.close())
  }
}
