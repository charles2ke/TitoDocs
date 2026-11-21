import type { TextEncodingName } from '../code/textOps';

/**
 * Content waiting to be inserted into a freshly created file once its editor has connected
 * (templates and imported files). Kept in memory: navigation within the app is client-side.
 * Imported text files also remember their encoding, which is used again when they are downloaded.
 */
export type InitialContent = { kind: 'html'; html: string } | { kind: 'text'; text: string; encoding?: TextEncodingName };

const pending = new Map<string, InitialContent>();

export const setInitialContent = (fileId: string, content: InitialContent): void => {
  pending.set(fileId, content);
};

export function takeInitialContent(fileId: string): InitialContent | null {
  const content = pending.get(fileId) ?? null;
  pending.delete(fileId);
  return content;
}

export interface DocTemplate {
  id: string;
  name: string;
  title: string;
  description: string;
  html: string;
}

const today = () => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

export const DOC_TEMPLATES: (() => DocTemplate)[] = [
  () => ({
    id: 'blank',
    name: 'Blank document',
    title: 'Untitled document',
    description: 'Start from scratch',
    html: '',
  }),
  () => ({
    id: 'resume',
    name: 'Résumé',
    title: 'Résumé',
    description: 'Clean one-page résumé',
    html: `
<h1 style="text-align: center">Your Name</h1>
<p style="text-align: center"><span style="color: #5f6368">City, Country · you@example.com · +1 555 0100 · linkedin.com/in/you</span></p>
<hr>
<h2>Summary</h2>
<p>Results-driven professional with experience in delivering projects end to end. Replace this with two or three sentences about you.</p>
<h2>Experience</h2>
<h3>Job Title — Company</h3>
<p><em>Jan 2022 – Present · City</em></p>
<ul><li><p>Led a team of 5 to deliver a product used by 20,000 customers.</p></li><li><p>Reduced costs by 15% by automating manual processes.</p></li></ul>
<h3>Previous Job Title — Company</h3>
<p><em>2019 – 2021 · City</em></p>
<ul><li><p>Describe an accomplishment with a measurable result.</p></li></ul>
<h2>Education</h2>
<p><strong>Degree, Field of study</strong> — University, 2019</p>
<h2>Skills</h2>
<p>Project management · Communication · Data analysis · Your skills here</p>`,
  }),
  () => ({
    id: 'letter',
    name: 'Letter',
    title: 'Letter',
    description: 'Formal business letter',
    html: `
<p>Your Name<br>Street Address<br>City, Postal Code</p>
<p>${today()}</p>
<p>Recipient Name<br>Company<br>Street Address<br>City, Postal Code</p>
<p>Dear Recipient,</p>
<p>I am writing to … Start with the purpose of your letter, then add supporting details in the following paragraphs.</p>
<p>Close with a summary and any next steps you expect.</p>
<p>Sincerely,</p>
<p><br></p>
<p>Your Name</p>`,
  }),
  () => ({
    id: 'meeting-notes',
    name: 'Meeting notes',
    title: `Meeting notes – ${today()}`,
    description: 'Agenda, notes and action items',
    html: `
<h1>Meeting notes</h1>
<p><strong>Date:</strong> ${today()}<br><strong>Attendees:</strong> @name, @name</p>
<h2>Agenda</h2>
<ol><li><p>Updates</p></li><li><p>Discussion</p></li><li><p>Next steps</p></li></ol>
<h2>Notes</h2>
<ul><li><p>…</p></li></ul>
<h2>Action items</h2>
<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Owner – action – due date</p></li><li data-type="taskItem" data-checked="false"><p>Owner – action – due date</p></li></ul>
<h2>Decisions</h2>
<table><tbody><tr><th><p>Decision</p></th><th><p>Owner</p></th><th><p>Date</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>`,
  }),
  () => ({
    id: 'proposal',
    name: 'Project proposal',
    title: 'Project proposal',
    description: 'Goals, scope, timeline and budget',
    html: `
<h1>Project name</h1>
<p><span style="color: #5f6368">Prepared by Your Name · ${today()}</span></p>
<div data-type="table-of-contents"></div>
<h2>Overview</h2>
<p>Summarise the problem and the proposed solution in one paragraph.</p>
<h2>Goals</h2>
<ul><li><p>Goal one</p></li><li><p>Goal two</p></li></ul>
<h2>Scope</h2>
<p>What is included, and what is explicitly out of scope.</p>
<h2>Timeline</h2>
<table><tbody><tr><th><p>Milestone</p></th><th><p>Description</p></th><th><p>Target date</p></th></tr><tr><td><p>Kick-off</p></td><td><p>Team formed, plan agreed</p></td><td><p></p></td></tr><tr><td><p>Beta</p></td><td><p>First version with users</p></td><td><p></p></td></tr><tr><td><p>Launch</p></td><td><p>General availability</p></td><td><p></p></td></tr></tbody></table>
<h2>Budget</h2>
<p>Estimated costs and resources.</p>
<h2>Risks</h2>
<blockquote><p>List the main risks and how you will mitigate them.</p></blockquote>`,
  }),
];

export interface CodeTemplate {
  id: string;
  name: string;
  title: string;
  text: string;
}

export const CODE_TEMPLATES: CodeTemplate[] = [
  { id: 'text', name: 'Text file', title: 'untitled.txt', text: '' },
  {
    id: 'python',
    name: 'Python script',
    title: 'main.py',
    text: 'def main() -> None:\n    print("Hello from TitoDocs!")\n\n\nif __name__ == "__main__":\n    main()\n',
  },
  {
    id: 'web',
    name: 'Web page',
    title: 'index.html',
    text: '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>Hello</title>\n  </head>\n  <body>\n    <h1>Hello, world!</h1>\n  </body>\n</html>\n',
  },
  {
    id: 'javascript',
    name: 'JavaScript',
    title: 'script.js',
    text: "export function greet(name) {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet('TitoDocs'));\n",
  },
  { id: 'markdown', name: 'Markdown', title: 'README.md', text: '# Project\n\nDescribe your project here.\n' },
];
