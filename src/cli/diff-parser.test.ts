import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './diff-parser';

describe('parseUnifiedDiff', () => {
  it('parses additions, deletions, renames, and hunk line numbers', () => {
    const files = parseUnifiedDiff(`diff --git a/a.ts b/b.ts
similarity index 80%
rename from a.ts
rename to b.ts
--- a/a.ts
+++ b/b.ts
@@ -1,3 +1,4 @@
 import x from 'x';
-const oldName = 1;
+const newName = 1;
+const added = 2;
 export { x };
`);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: 'b.ts',
      oldPath: 'a.ts',
      additions: 2,
      deletions: 1,
      isRenamed: true,
      language: 'ts'
    });
    expect(files[0]?.hunks[0]?.lines).toEqual([
      { type: 'context', oldLine: 1, newLine: 1, content: "import x from 'x';" },
      { type: 'delete', oldLine: 2, newLine: null, content: 'const oldName = 1;' },
      { type: 'add', oldLine: null, newLine: 2, content: 'const newName = 1;' },
      { type: 'add', oldLine: null, newLine: 3, content: 'const added = 2;' },
      { type: 'context', oldLine: 3, newLine: 4, content: 'export { x };' }
    ]);
  });
});
