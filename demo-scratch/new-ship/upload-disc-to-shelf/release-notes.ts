/** Header interaction only. Product notes are ordinary authored content; the
 * semantic version itself is stamped from the canonical manifest at build. */
export function mountReleaseNotes(root: Document = document) {
  const trigger=root.getElementById('discstudio-version') as HTMLButtonElement|null;
  const dialog=root.getElementById('discstudio-release-notes') as HTMLDialogElement|null;
  if(!trigger || !dialog) return;
  const open=()=>{if(!dialog.open)dialog.showModal();};
  trigger.addEventListener('dblclick',open);
  trigger.addEventListener('click',event=>{if(event.detail===0)open();});
  root.getElementById('release-notes-close')!.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>trigger.focus());
}
