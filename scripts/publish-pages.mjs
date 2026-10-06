import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const root = git('rev-parse', '--show-toplevel');
const gitDirectory = git('rev-parse', '--absolute-git-dir');
const temporary = mkdtempSync(join(tmpdir(), 'felis-pages-'));
const indexEnvironment = { ...process.env, GIT_INDEX_FILE: join(temporary, 'index') };
try {
  execFileSync('npm', ['test'], { cwd: root, stdio: 'inherit' });
  execFileSync('npm', ['run', 'build'], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, FELIS_BASE_PATH: process.env.FELIS_BASE_PATH || '/gatto/' },
  });
  writeFileSync(join(root, 'dist', '.nojekyll'), '');
  const remote = git('ls-remote', 'origin', 'refs/heads/gh-pages');
  const parent = remote ? remote.split(/\s+/)[0] : null;
  if (parent) execFileSync('git', ['fetch', 'origin', 'gh-pages'], { cwd: root, stdio: 'inherit' });
  const treeArgs = [`--git-dir=${gitDirectory}`, `--work-tree=${join(root, 'dist')}`];
  execFileSync('git', [...treeArgs, 'add', '--all'], { cwd: root, env: indexEnvironment });
  const tree = execFileSync('git', [...treeArgs, 'write-tree'], { cwd: root, env: indexEnvironment, encoding: 'utf8' }).trim();
  const args = ['commit-tree', tree, '-m', 'Publish the playable Felis room'];
  if (parent) args.push('-p', parent);
  const commit = execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  execFileSync('git', ['push', 'origin', `${commit}:refs/heads/gh-pages`], { cwd: root, stdio: 'inherit' });
  console.log(`Sito compilato pubblicato nel branch gh-pages: ${commit}`);
  console.log('GitHub Pages deve usare il branch gh-pages, cartella / (root).');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
