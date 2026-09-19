const fs = require('fs')
const edit = (p, pairs) => {
  let s = fs.readFileSync(p, 'utf8').split('\r\n').join('\n')
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error(p + ' missing: ' + a.slice(0, 60))
    s = s.replace(a, b)
  }
  fs.writeFileSync(p, s)
}
edit('worker/evidence/run-extraction.test.ts', [[
`    const evidence = walk(join(root, 'src/features/evidence-matrix')).filter((p) => !/\.test\.ts$/.test(p))
    for (const path of evidence) {
      expect(strip(readFileSync(path, 'utf8')), path).not.toMatch(/supabase|process\.env/)
    }`,
`    // The extraction service (pure) must not touch Supabase or the environment. The
    // browser data layer (api/queries/status/types and ui/) is the one place allowed to
    // use the anon browser client, and it must not import the extraction service back.
    const BROWSER_LAYER = /[\\/]evidence-matrix[\\/](api|queries|status|types)\.ts$|[\\/]evidence-matrix[\\/]ui[\\/]/
    const evidence = walk(join(root, 'src/features/evidence-matrix')).filter((p) => !/\.test\.tsx?$/.test(p))
    for (const path of evidence.filter((p) => !BROWSER_LAYER.test(p))) {
      expect(strip(readFileSync(path, 'utf8')), path).not.toMatch(/supabase|process\.env/)
    }
    for (const path of evidence.filter((p) => BROWSER_LAYER.test(p))) {
      expect(strip(readFileSync(path, 'utf8')), path).not.toMatch(/from '\.\/(extract|prompt|evidence-packet|schema)'/)
    }`]])
edit('src/features/evidence-matrix/browser-data.test.ts', [[
`const mock = vi.hoisted(() => ({
  current: undefined as unknown,
}))`,
`const mock = vi.hoisted((): { current: unknown } => ({ current: undefined }))`]])
