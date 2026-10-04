import { mkdir, writeFile } from 'node:fs/promises';
import { workflowSkills } from '../src/workflows/skills.js';
for (const file of workflowSkills.files) {
  const directory = `skills/${file.frontmatter.name}`;
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/SKILL.md`, file.text, 'utf8');
}
