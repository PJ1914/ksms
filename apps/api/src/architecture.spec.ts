import fs from 'node:fs';
import path from 'node:path';

/**
 * Module boundaries (docs/architecture/SYSTEM_CONTEXT.md section 4): lower layers never import from higher ones,
 * and there are no cycles. This test reads the real imports, so a wrong import fails `pnpm check` and CI.
 *
 * When a module is added or starts using another, update ALLOWED here AND the diagram in SYSTEM_CONTEXT.md.
 */
const MODULES_DIR = path.resolve(__dirname, 'modules');
const SRC_DIR = __dirname;

/** For each module: the other modules it may import from (everything else is forbidden). */
const ALLOWED: Record<string, string[]> = {
  audit: [],
  organization: ['audit'],
  identity: ['audit', 'organization'],
  catalog: ['audit', 'organization'],
  inventory: ['audit', 'organization', 'catalog'],
  procurement: ['audit', 'organization', 'catalog', 'inventory'],
  context: ['audit', 'organization', 'identity'],
  health: [],
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'generated' ? [] : sourceFiles(full);
    return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [full] : [];
  });
}

/** Resolved target of every relative import in a file. */
function relativeImports(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const pattern = /(?:from|import\s*\(?|require\s*\()\s*['"](\.[^'"]*)['"]/g;
  const targets = [...text.matchAll(pattern)].map((m) => m[1]!);
  return targets.map((t) => path.resolve(path.dirname(file), t));
}

function moduleOf(absolute: string): string | null {
  const rel = path.relative(MODULES_DIR, absolute);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep)[0] ?? null;
}

describe('module boundaries', () => {
  const modules = fs
    .readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  it('every module is listed in the architecture map', () => {
    expect(modules.filter((m) => !(m in ALLOWED))).toEqual([]);
  });

  it.each(modules)('%s only imports modules it is allowed to', (name) => {
    const violations: string[] = [];
    for (const file of sourceFiles(path.join(MODULES_DIR, name))) {
      for (const target of relativeImports(file)) {
        const other = moduleOf(target);
        if (other && other !== name && !(ALLOWED[name] ?? []).includes(other)) {
          violations.push(`${path.relative(SRC_DIR, file)} imports ${other}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('shared code in common/ never reaches up into feature modules', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(path.join(SRC_DIR, 'common'))) {
      for (const target of relativeImports(file)) {
        const other = moduleOf(target);
        if (other) violations.push(`${path.relative(SRC_DIR, file)} imports modules/${other}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('the allowed-imports map has no cycles', () => {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (m: string, trail: string[]) => {
      if (done.has(m)) return;
      if (visiting.has(m)) throw new Error(`cycle: ${[...trail, m].join(' -> ')}`);
      visiting.add(m);
      for (const next of ALLOWED[m] ?? []) visit(next, [...trail, m]);
      visiting.delete(m);
      done.add(m);
    };
    expect(() => Object.keys(ALLOWED).forEach((m) => visit(m, []))).not.toThrow();
  });
});
