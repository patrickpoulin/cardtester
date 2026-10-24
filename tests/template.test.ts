import { describe, expect, it } from 'vitest';
import { loadGame } from '../src/dsl/compile';
import { PROMPTS, TEMPLATE, TEMPLATE_FILE_NAME } from '../src/template';

describe('Claude template', () => {
  it('includes the format reference and every example game', () => {
    expect(TEMPLATE).toContain('# The game.yaml format');
    const examples = [...TEMPLATE.slice(TEMPLATE.indexOf('## Example games')).matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(examples).toHaveLength(3);
    for (const source of examples) expect(() => loadGame(source)).not.toThrow();
  });

  it('names the template file in the first prompt', () => {
    expect(PROMPTS[0].text).toContain(TEMPLATE_FILE_NAME);
  });
});
