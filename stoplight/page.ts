// stoplight.json -> one static HTML page (published on the repo's GitHub Pages site at /stoplight/).
import type { ItemLight } from './stoplight.ts';

interface Receipt {
	readonly items: readonly { id: string; what: string }[];
	readonly lights: readonly ItemLight[];
	readonly commit?: string;
	readonly ranAt?: string;
}

const esc = (text: string) =>
	text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const label = { green: 'Green', yellow: 'Yellow', red: 'Red' } as const;

export function renderPage(receipt: Receipt): string {
	const what = new Map(receipt.items.map((i) => [i.id, i.what]));
	const count = (l: string) => receipt.lights.filter((x) => x.light === l).length;
	const order = { red: 0, yellow: 1, green: 2 } as const;
	const rows = [...receipt.lights]
		.sort((a, b) => order[a.light] - order[b.light])
		.map((l) => {
			const results = l.has.crucibles.results;
			const reused = results.filter((r) => r.reused).length;
			const runs = results.length ? `${results.length} crucible${results.length > 1 ? 's' : ''}${reused ? `, ${reused} reused` : ''}` : 'no crucible';
			return `<li class="row ${l.light}"><span class="dot" aria-hidden="true"></span><div><p class="name">${esc(l.item)} <span class="tag">${label[l.light]}</span></p><p class="what">${esc(what.get(l.item) ?? '')} · ${runs}</p><p class="why">${esc(l.why)}</p></div></li>`;
		})
		.join('\n');
	const stamp = [receipt.ranAt, receipt.commit && `commit ${receipt.commit.slice(0, 7)}`].filter(Boolean).join(' · ');
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lane Stoplight</title>
<style>
:root { --bg:#fbfaf8; --fg:#1d1c1a; --muted:#5f5c57; --line:#e4e1dc; --green:#2f7d4f; --yellow:#a36b00; --red:#b3261e; }
@media (prefers-color-scheme: dark) { :root { --bg:#161514; --fg:#ecebe8; --muted:#a9a59f; --line:#2f2d2a; --green:#5cbf84; --yellow:#e0a93a; --red:#f07167; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
main { max-width:760px; margin:0 auto; padding:24px 16px 48px; }
h1 { font-size:1.5rem; margin:0 0 4px; }
.sum { color:var(--muted); margin:0 0 20px; }
ul { list-style:none; padding:0; margin:0; }
.row { display:flex; gap:12px; padding:14px 0; border-top:1px solid var(--line); }
.dot { flex:none; width:14px; height:14px; border-radius:50%; margin-top:5px; background:var(--c); }
.green { --c:var(--green); } .yellow { --c:var(--yellow); } .red { --c:var(--red); }
.name { margin:0; font-weight:600; overflow-wrap:anywhere; }
.tag { font-weight:500; font-size:.8rem; color:var(--c); margin-left:6px; }
.what, .why { margin:2px 0 0; color:var(--muted); font-size:.9rem; overflow-wrap:anywhere; }
footer { margin-top:24px; color:var(--muted); font-size:.85rem; }
</style>
</head>
<body>
<main>
<h1>Lane stoplight</h1>
<p class="sum">${count('green')} green · ${count('yellow')} yellow · ${count('red')} red</p>
<ul>
${rows}
</ul>
<footer>Green: every crucible ran as expected, including broken copies that must be caught. Yellow: no crucible yet, or it could not run here. Red: it ran and came out wrong.${stamp ? `<br>${esc(stamp)}` : ''} · <a href="stoplight.json">stoplight.json</a></footer>
</main>
</body>
</html>
`;
}
