import { describe, expect, it } from 'vitest';
import { loadGame } from '../src/dsl/compile';
import { TEMPLATE } from '../src/template';

describe('Claude template', () => {
  it('includes the format reference and every example game', () => {
    expect(TEMPLATE).toContain('# The game.yaml format');
    const examples = [...TEMPLATE.slice(TEMPLATE.indexOf('## Example games')).matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(examples).toHaveLength(4);
    for (const source of examples) expect(() => loadGame(source)).not.toThrow();
  });
});
