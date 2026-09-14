const TranscriberProject = (() => {
  const MAX_IMAGE_PIXELS = 18_000_000;
  const MAX_PROJECT_BYTES = 120_000_000;
  const MAX_MATCHES = 100_000;

  function validateBox(box, width, height) {
    if (!box || !['x', 'y', 'w', 'h'].every((key) => Number.isInteger(box[key]))) {
      throw new Error('Box coordinates must be integers.');
    }
    if (
      box.x < 0 ||
      box.y < 0 ||
      box.w < 1 ||
      box.h < 1 ||
      box.x + box.w > width ||
      box.y + box.h > height
    ) {
      throw new Error('A box is outside the image.');
    }
    return { x: box.x, y: box.y, w: box.w, h: box.h };
  }

  function parseProject(text) {
    const project = JSON.parse(text);
    if (
      !project ||
      project.version !== 1 ||
      !Array.isArray(project.groups) ||
      project.groups.length > 1000 ||
      typeof project.image !== 'string' ||
      !/^data:image\/(png|jpeg|webp);base64,/i.test(project.image) ||
      typeof project.name !== 'string'
    ) {
      throw new Error('Invalid project format.');
    }
    return project;
  }

  function validateGroups(groups, width, height) {
    let matchCount = 0;
    const orders = new Set();
    return groups.map((group) => {
      if (
        !group ||
        typeof group.label !== 'string' ||
        !group.label.length ||
        group.label.length > 12 ||
        typeof group.color !== 'string' ||
        !/^#[0-9a-f]{6}$/i.test(group.color) ||
        !Array.isArray(group.matches) ||
        !Number.isFinite(group.threshold) ||
        group.threshold < 0.65 ||
        group.threshold > 1 ||
        typeof group.scales !== 'boolean'
      ) {
        throw new Error('Invalid symbol settings.');
      }
      const matchMode = group.matchMode === undefined ? 'luminance' : group.matchMode;
      const colorTolerance =
        group.colorTolerance === undefined ? 0.12 : group.colorTolerance;
      const allowInverted =
        group.allowInverted === undefined ? false : group.allowInverted;
      if (
        !['luminance', 'color'].includes(matchMode) ||
        !Number.isFinite(colorTolerance) ||
        colorTolerance < 0 ||
        colorTolerance > 0.5 ||
        typeof allowInverted !== 'boolean' ||
        (matchMode === 'color' && allowInverted)
      ) {
        throw new Error('Invalid color matching settings.');
      }
      matchCount += group.matches.length;
      if (matchCount > MAX_MATCHES) throw new Error('Too many matches in this project.');
      const rect = validateBox(group.rect, width, height);
      if (
        group.excluded !== undefined &&
        (!Array.isArray(group.excluded) || group.excluded.length > MAX_MATCHES)
      )
        throw new Error('Invalid excluded occurrences.');
      const excluded = (group.excluded || []).map((box) =>
        validateBox(box, width, height),
      );
      matchCount += excluded.length;
      if (matchCount > MAX_MATCHES)
        throw new Error('Too many occurrences in this project.');
      if (rect.w < 3 || rect.h < 3)
        throw new Error('A sample must be at least 3 by 3 pixels.');
      const matches = group.matches.map((match) => {
        const box = validateBox(match, width, height);
        if (!Number.isFinite(match.score) || match.score < 0 || match.score > 1) {
          throw new Error('Invalid match score.');
        }
        if (
          match.order !== undefined &&
          (!Number.isInteger(match.order) ||
            match.order < 1 ||
            match.order > MAX_MATCHES ||
            orders.has(match.order))
        )
          throw new Error('Invalid or duplicate route position.');
        if (match.order !== undefined) orders.add(match.order);
        if (match.after !== undefined && !['', ' ', '\n'].includes(match.after))
          throw new Error('Invalid match separator.');
        if (match.manual !== undefined && typeof match.manual !== 'boolean')
          throw new Error('Invalid manual match flag.');
        return {
          ...box,
          score: match.score,
          ...(match.order === undefined ? {} : { order: match.order }),
          ...(match.after === undefined ? {} : { after: match.after }),
          ...(match.manual ? { manual: true } : {}),
        };
      });
      return {
        label: group.label,
        color: group.color,
        rect,
        matches,
        threshold: group.threshold,
        scales: group.scales,
        matchMode,
        colorTolerance,
        allowInverted,
        ...(excluded.length ? { excluded } : {}),
      };
    });
  }

  class EditHistory {
    constructor(limit = 60) {
      this.limit = limit;
      this.undoStack = [];
      this.redoStack = [];
    }
    get canUndo() {
      return this.undoStack.length > 0;
    }
    get canRedo() {
      return this.redoStack.length > 0;
    }
    clear() {
      this.undoStack = [];
      this.redoStack = [];
    }
    record(state) {
      this.undoStack.push(structuredClone(state));
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack = [];
    }
    undo(state) {
      return this.restore(this.undoStack, this.redoStack, state);
    }
    redo(state) {
      return this.restore(this.redoStack, this.undoStack, state);
    }
    restore(from, to, state) {
      if (!from.length) return null;
      to.push(structuredClone(state));
      return from.pop();
    }
  }

  function validateReading(value = {}) {
    const defaults = {
      mode: 'rows-ltr',
      tolerance: 0.5,
      separator: '',
      lineBreaks: true,
    };
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid reading settings.');
    const result = { ...defaults, ...value };
    if (
      ![
        'rows-ltr',
        'rows-rtl',
        'rows-snake',
        'columns-ltr',
        'columns-rtl',
        'columns-snake',
        'custom',
      ].includes(result.mode) ||
      !Number.isFinite(result.tolerance) ||
      result.tolerance < 0.2 ||
      result.tolerance > 1 ||
      !['', ' ', '/'].includes(result.separator) ||
      typeof result.lineBreaks !== 'boolean'
    )
      throw new Error('Invalid reading settings.');
    return result;
  }

  function transcribe(groups, tolerance = 0.5, options = {}) {
    const settings = validateReading({ ...options, tolerance });
    const items = groups.flatMap((group) =>
      group.matches.map((box) => ({ ...box, label: group.label })),
    );
    const join = (list) =>
      list
        .map(
          (box, i) =>
            box.label + (box.after || (i < list.length - 1 ? settings.separator : '')),
        )
        .join('');
    if (settings.mode === 'custom')
      return join(
        items.filter((b) => b.order !== undefined).sort((a, b) => a.order - b.order),
      );
    const columns = settings.mode.startsWith('columns');
    if (columns)
      items.forEach((b) => {
        [b.x, b.y, b.w, b.h] = [b.y, b.x, b.h, b.w];
      });
    items.sort((a, b) => a.y + a.h / 2 - b.y - b.h / 2);
    const rows = [];
    for (const box of items) {
      const centerY = box.y + box.h / 2;
      let row = rows.find(
        (candidate) =>
          Math.abs(candidate.centerY - centerY) <=
          Math.min(candidate.height, box.h) * tolerance,
      );
      if (!row) {
        row = { centerY, height: box.h, items: [] };
        rows.push(row);
      }
      row.items.push(box);
    }
    rows.sort((a, b) => a.centerY - b.centerY);
    if (settings.mode === 'columns-rtl') rows.reverse();
    return rows
      .map((row, i) => {
        row.items.sort((a, b) => a.x - b.x);
        if (settings.mode === 'rows-rtl' || (settings.mode.endsWith('snake') && i % 2))
          row.items.reverse();
        return join(row.items);
      })
      .join(settings.lineBreaks ? '\n' : settings.separator);
  }

  function exportCsv(groups) {
    // A quoted field alone does not prevent spreadsheet formula execution.
    const escape = (text) =>
      '"' + (/^[=+@\-\t\r\n]/.test(text) ? "'" : '') + text.replaceAll('"', '""') + '"';
    const rows = ['label,x,y,width,height,similarity'];
    for (const group of groups) {
      for (const box of group.matches) {
        rows.push(
          [escape(group.label), box.x, box.y, box.w, box.h, box.score.toFixed(5)].join(
            ',',
          ),
        );
      }
    }
    return rows.join('\n') + '\n';
  }

  return {
    MAX_IMAGE_PIXELS,
    MAX_PROJECT_BYTES,
    EditHistory,
    parseProject,
    validateGroups,
    validateReading,
    transcribe,
    exportCsv,
  };
})();
if (typeof module !== 'undefined') module.exports = TranscriberProject;
