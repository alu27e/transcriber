(() => {
  const toolPaths = {
    select:
      '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 2v4m8-4v4M2 8h4m-4 8h4m12-8h4m-4 8h4M8 18v4m8-4v4"/>',
    pan: '<path d="m5 9-3 3 3 3m4-10 3-3 3 3m4 4 3 3-3 3m-4 4-3 3-3-3M2 12h20M12 2v20"/>',
    erase:
      '<path d="m7 21-5-5a2 2 0 0 1 0-3L13 2a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3L12 21H7Zm-2-11 10 10M12 21h10"/>',
    undo: '<path d="M3 10h11a7 7 0 0 1 0 14M3 10l5-5M3 10l5 5" transform="translate(0 -3)"/>',
    redo: '<path d="M21 10H10a7 7 0 0 0 0 14m11-14-5-5m5 5-5 5" transform="translate(0 -3)"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M5 12h14m-7-7v14"/>',
  };
  for (const [id, path] of Object.entries(toolPaths))
    document.getElementById(id).innerHTML =
      `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
})();
