// 集成测试只装配假宿主/假协议端，不启动 Cortico、NapCat 或真实 bot。
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = resolve(import.meta.dirname, '..');
const framework = resolve(process.env.CORTICO_ROOT || resolve(repo, '../Cortico'));
const require = createRequire(import.meta.url);
const loader = require.resolve('tsx', { paths: [repo, framework] });
const result = spawnSync(process.execPath, ['--import', pathToFileURL(loader).href,
  '--import', pathToFileURL(resolve(framework, 'src/extensions/runtime.ts')).href,
  '--test', 'tests/inbox-world.test.ts'], { cwd: repo, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
