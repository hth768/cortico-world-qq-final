import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const output = resolve(process.argv[2] || join(repo, '..', '_qqfinal_release'));
const corticoRoot = process.env.CORTICO_ROOT || join(repo, '..', 'Cortico');
const requireFromRepo = createRequire(join(repo, 'package.json'));

let esbuild;
try {
  const path = requireFromRepo.resolve('esbuild', { paths: [repo, corticoRoot] });
  esbuild = requireFromRepo(path);
} catch {
  throw new Error('找不到 esbuild；请安装依赖，或设置 CORTICO_ROOT 指向包含 node_modules/esbuild 的 Cortico 工作区。');
}

rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, 'dist'), { recursive: true });

const sourcePackage = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const releasePackage = {
  ...sourcePackage,
  main: './dist/index.js',
  files: ['dist', 'describe.json', 'README.md', 'CHANGELOG.md', 'ENV_PROMPT.md', 'asr_sidecar.py', 'LICENSE'],
};
delete releasePackage.scripts;
writeFileSync(join(output, 'package.json'), `${JSON.stringify(releasePackage, null, 2)}\n`, 'utf8');

for (const file of ['describe.json', 'README.md', 'CHANGELOG.md', 'ENV_PROMPT.md', 'asr_sidecar.py', 'LICENSE']) {
  cpSync(join(repo, file), join(output, file));
}
for (const file of ['console.js', 'console.css']) {
  cpSync(join(repo, 'dist', file), join(output, 'dist', file));
}

await esbuild.build({
  entryPoints: [join(repo, 'src', 'index.ts')],
  outfile: join(output, 'dist', 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // 保留运行时依赖自己的加载器/资源目录（silk-wasm 含 CommonJS 与 WASM 资源）。
  external: ['cortico/*', 'node:*', ...Object.keys(sourcePackage.dependencies || {})],
  minifyIdentifiers: true,
  minifySyntax: true,
  minifyWhitespace: true,
  legalComments: 'none',
  keepNames: false,
  charset: 'utf8',
});

console.log(`已生成发布副本: ${output}`);
console.log(`入口: ${join(output, 'dist', 'index.js')}`);
