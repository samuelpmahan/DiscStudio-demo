import { creatorWalkthroughGroups } from './creator-walkthrough.ts';
const root = document.querySelector('#creator-review-content')!;
for (const group of creatorWalkthroughGroups) {
  const section = document.createElement('section'); section.className = 'creator-review-group';
  const heading = document.createElement('h2'); heading.textContent = group.label; section.append(heading);
  for (const row of group.items) {
    const article = document.createElement('article'); article.id = row.reviewId;
    article.innerHTML = `<h3>${row.label}</h3><p><b>Do:</b> ${row.creator.do}</p><p><b>Expect:</b> ${row.creator.expect}</p><p><b>Recovery:</b> ${row.creator.recovery}</p><details><summary>Developer boundary and evidence</summary><dl><dt>Input</dt><dd>${row.developer.input}</dd><dt>Calculation</dt><dd>${row.developer.calculation}</dd><dt>Output</dt><dd>${row.developer.output}</dd><dt>Owning source</dt><dd>${row.developer.owningSource}</dd><dt>Evidence</dt><dd>${row.evidence.whatToObserve}</dd><dt>Checkpoint</dt><dd>${row.evidence.exactCheckpoint}</dd></dl></details>`;
    section.append(article);
  }
  root.append(section);
}

const target = location.hash && document.getElementById(location.hash.slice(1));
if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
