'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas'),
    context = canvas.getContext('2d'),
    imageCanvas = document.createElement('canvas'),
    imageContext = imageCanvas.getContext('2d', { willReadFrequently: true });
  let groups = [],
    selected = -1,
    mode = 'select',
    zoom = 1,
    offset = { x: 0, y: 0 },
    drag = null,
    imageName = '',
    loadRequest = 0;
  const editHistory = new TranscriberProject.EditHistory();
  const symbolSearch = new SymbolSearch(matchSymbols);
  const palette = ['#66d7d0', '#ec7985', '#edce71', '#7cb5f1', '#a6dc7d', '#c5a3ed'];
  let reading = TranscriberProject.validateReading(),
    reviewPage = 0;
  function setStatus(text) {
    $('status').textContent = text;
  }
  function recordEdit() {
    editHistory.record({ groups, selected, reading });
  }
  function restoreEdit(direction) {
    stopSearch();
    const previous = editHistory[direction]({ groups, selected, reading });
    if (!previous) return;
    groups = previous.groups;
    selected = previous.selected;
    reading = previous.reading;
    render();
    setStatus('Change restored.');
  }
  function getSelectedGroup() {
    return groups[selected];
  }
  function rejectMatch(group, box) {
    group.excluded ||= [];
    group.excluded.push({ x: box.x, y: box.y, w: box.w, h: box.h });
    group.matches.splice(group.matches.indexOf(box), 1);
  }
  function setMode(nextMode) {
    drag = null;
    mode = nextMode;
    ['select', 'pan', 'erase', 'manual', 'route'].forEach((x) =>
      $(x).classList.toggle('active', x === nextMode),
    );
    canvas.style.cursor =
      nextMode === 'pan' ? 'grab' : nextMode === 'erase' ? 'not-allowed' : 'crosshair';
  }
  function resize() {
    const r = $('stage').getBoundingClientRect();
    canvas.width = Math.round(r.width * devicePixelRatio);
    canvas.height = Math.round(r.height * devicePixelRatio);
    renderCanvas();
  }
  function fitImageToViewport() {
    if (!imageCanvas.width) return;
    const r = $('stage').getBoundingClientRect();
    zoom = Math.min(
      (r.width - 70) / imageCanvas.width,
      (r.height - 70) / imageCanvas.height,
      3,
    );
    zoom = Math.max(0.05, zoom);
    offset = {
      x: (r.width - imageCanvas.width * zoom) / 2,
      y: (r.height - imageCanvas.height * zoom) / 2,
    };
    renderCanvas();
  }
  function drawMatchBox(c, b, color, label, viewZoom = zoom) {
    c.strokeStyle = color;
    c.lineWidth = 1.5 / viewZoom;
    c.fillStyle = color + '12';
    c.fillRect(b.x, b.y, b.w, b.h);
    c.strokeRect(b.x, b.y, b.w, b.h);
    if ($('labels').checked && label) {
      c.font = `${Math.max(9, 11 / viewZoom)}px monospace`;
      c.fillStyle = color;
      c.fillText(label, b.x, b.y - 3 / viewZoom);
    }
  }
  function renderCanvas() {
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.translate(offset.x, offset.y);
    context.scale(zoom, zoom);
    context.imageSmoothingEnabled = zoom < 2;
    if (imageCanvas.width) context.drawImage(imageCanvas, 0, 0);
    if ($('boxes').checked)
      groups.forEach((g) =>
        g.matches.forEach((b) => drawMatchBox(context, b, g.color, g.label)),
      );
    if (reading.mode === 'custom') {
      const route = groups
        .flatMap((g) => g.matches)
        .filter((b) => b.order !== undefined)
        .sort((a, b) => a.order - b.order);
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1.5 / zoom;
      context.beginPath();
      route.forEach((b, i) => {
        const x = b.x + b.w / 2,
          y = b.y + b.h / 2;
        if (i) context.lineTo(x, y);
        else context.moveTo(x, y);
      });
      context.stroke();
      route.forEach((b, i) => {
        context.fillStyle = '#000000';
        context.fillRect(b.x, b.y, 24 / zoom, 16 / zoom);
        context.fillStyle = '#ffffff';
        context.font = `12px monospace`;
        context.save();
        context.translate(b.x, b.y);
        context.scale(1 / zoom, 1 / zoom);
        context.fillText(String(i + 1), 2, 12);
        context.restore();
      });
    }
    if (drag && ['select', 'manual'].includes(mode)) {
      const r = getSelectionBounds(drag.start, drag.current);
      drawMatchBox(context, r, palette[groups.length % palette.length], '');
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    $('zoom').textContent = Math.round(zoom * 100) + '%';
  }
  function getImagePoint(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(imageCanvas.width, (e.clientX - r.left - offset.x) / zoom)),
      y: Math.max(0, Math.min(imageCanvas.height, (e.clientY - r.top - offset.y) / zoom)),
    };
  }
  function getSelectionBounds(a, b) {
    return {
      x: Math.floor(Math.min(a.x, b.x)),
      y: Math.floor(Math.min(a.y, b.y)),
      w: Math.ceil(Math.abs(b.x - a.x)),
      h: Math.ceil(Math.abs(b.y - a.y)),
    };
  }
  canvas.onpointerdown = (e) => {
    if (!imageCanvas.width || symbolSearch.running) return;
    canvas.setPointerCapture(e.pointerId);
    if (mode === 'manual' && !getSelectedGroup()) {
      setStatus('Select a symbol first.');
      return;
    }
    if (mode === 'erase' || mode === 'route') {
      const p = getImagePoint(e);
      for (let gi = groups.length - 1; gi >= 0; gi--) {
        const i = groups[gi].matches.findIndex(
          (b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h,
        );
        if (i >= 0) {
          recordEdit();
          if (mode === 'erase') rejectMatch(groups[gi], groups[gi].matches[i]);
          else {
            const box = groups[gi].matches[i];
            if (box.order !== undefined) delete box.order;
            else
              box.order =
                Math.max(
                  0,
                  ...groups.flatMap((g) => g.matches.map((b) => b.order || 0)),
                ) + 1;
            reading.mode = 'custom';
            groups
              .flatMap((g) => g.matches)
              .filter((b) => b.order !== undefined)
              .sort((a, b) => a.order - b.order)
              .forEach((b, i) => (b.order = i + 1));
          }
          render();
          setStatus(mode === 'erase' ? 'Match removed.' : 'Route updated.');
          break;
        }
      }
      return;
    }
    drag = {
      start: getImagePoint(e),
      current: getImagePoint(e),
      screen: { x: e.clientX, y: e.clientY },
      origin: { ...offset },
    };
  };
  canvas.onpointermove = (e) => {
    if (!drag) return;
    if (mode === 'pan')
      offset = {
        x: drag.origin.x + e.clientX - drag.screen.x,
        y: drag.origin.y + e.clientY - drag.screen.y,
      };
    else drag.current = getImagePoint(e);
    renderCanvas();
  };
  canvas.onpointerup = (e) => {
    if (!drag) return;
    if (mode === 'select' || mode === 'manual') {
      const r = getSelectionBounds(drag.start, getImagePoint(e));
      r.w = Math.min(r.w, imageCanvas.width - r.x);
      r.h = Math.min(r.h, imageCanvas.height - r.y);
      if (r.w >= 3 && r.h >= 3) {
        recordEdit();
        if (mode === 'manual') {
          getSelectedGroup().matches.push({ ...r, score: 1, manual: true });
          setStatus('Occurrence added.');
        } else {
          groups.push({
            label: String.fromCharCode(65 + (groups.length % 26)),
            color: palette[groups.length % palette.length],
            rect: r,
            matches: [],
            threshold: 0.92,
            scales: false,
            matchMode: $('matchMode').value || 'luminance',
            colorTolerance: Number($('colorTolerance').value) / 100,
            allowInverted:
              $('matchMode').value === 'luminance' && $('allowInverted').checked,
          });
          selected = groups.length - 1;
          setStatus('Sample selected. Click Find matches.');
        }
        render();
      }
    }
    drag = null;
    renderCanvas();
  };
  canvas.onpointercancel = () => {
    drag = null;
    renderCanvas();
  };
  function zoomAt(factor, x, y) {
    const next = Math.min(20, Math.max(0.05, zoom * factor));
    offset = {
      x: x - ((x - offset.x) * next) / zoom,
      y: y - ((y - offset.y) * next) / zoom,
    };
    zoom = next;
    renderCanvas();
  }
  canvas.onwheel = (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
  };
  function render() {
    $('classes').replaceChildren();
    groups.forEach((g, i) => {
      const b = document.createElement('button');
      b.className = 'symbolrow' + (i === selected ? ' selected' : '');
      b.style.setProperty('--color', g.color);
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.textContent = g.label;
      const n = document.createElement('span');
      n.className = 'name';
      n.textContent = 'Symbol ' + g.label;
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = g.matches.length;
      b.append(sw, n, count);
      b.onclick = () => {
        if (symbolSearch.running) return;
        selected = i;
        reviewPage = 0;
        render();
      };
      $('classes').append(b);
    });
    $('classCount').textContent = groups.length;
    $('total').textContent =
      groups.reduce((n, g) => n + g.matches.length, 0) + ' matches';
    const g = getSelectedGroup();
    $('search').disabled = !g || symbolSearch.running;
    $('deleteClass').disabled = !g || symbolSearch.running;
    $('sampleEmpty').hidden = !!g;
    $('undo').disabled = !editHistory.canUndo;
    $('redo').disabled = !editHistory.canRedo;
    [
      'label',
      'color',
      'threshold',
      'scales',
      'matchMode',
      'colorTolerance',
      'allowInverted',
    ].forEach((id) => ($(id).disabled = !g || symbolSearch.running));
    const p = $('sample').getContext('2d');
    p.clearRect(0, 0, 220, 120);
    if (g) {
      $('label').value = g.label;
      $('color').value = g.color;
      $('threshold').value = Math.round(g.threshold * 100);
      $('scales').checked = g.scales;
      $('matchMode').value = g.matchMode;
      $('colorTolerance').value = Math.round(g.colorTolerance * 100);
      $('allowInverted').checked = g.allowInverted;
      const r = g.rect,
        k = Math.min(180 / r.w, 85 / r.h, 8);
      p.imageSmoothingEnabled = false;
      p.drawImage(
        imageCanvas,
        r.x,
        r.y,
        r.w,
        r.h,
        (220 - r.w * k) / 2,
        (120 - r.h * k) / 2,
        r.w * k,
        r.h * k,
      );
      $('selectionInfo').textContent = `X ${r.x} · Y ${r.y}\n${r.w} × ${r.h} px`;
      $('matchCount').textContent = g.matches.length;
    } else {
      $('selectionInfo').textContent = '';
      $('matchCount').textContent = '—';
    }
    $('thresholdValue').textContent = $('threshold').value + '%';
    $('colorToleranceValue').textContent = $('colorTolerance').value + '%';
    $('colorSettings').hidden = $('matchMode').value !== 'color';
    $('invertedSettings').hidden = $('matchMode').value === 'color';
    $('readingMode').value = reading.mode;
    $('tokenSeparator').value = reading.separator;
    $('lineBreaks').checked = reading.lineBreaks;
    $('rowTolerance').value = Math.round(reading.tolerance * 100);
    $('rowValue').textContent = Math.round(reading.tolerance * 100) + '%';
    const allMatches = groups.flatMap((g) => g.matches);
    const routed = allMatches.filter((b) => b.order !== undefined).length;
    $('routeCount').textContent =
      reading.mode === 'custom'
        ? `${routed} / ${allMatches.length} in route; ${allMatches.length - routed} excluded`
        : '';
    $('clearRoute').hidden = reading.mode !== 'custom';
    $('clearRoute').disabled = !routed || symbolSearch.running;
    $('manual').disabled = !g || symbolSearch.running;
    $('resetExcluded').disabled = !g?.excluded?.length || symbolSearch.running;
    $('route').disabled = !allMatches.length || symbolSearch.running;
    renderReview();
    updateText();
    renderCanvas();
  }
  function renderReview() {
    const group = getSelectedGroup();
    const target = $('reassignTarget').value;
    $('reassignTarget').replaceChildren();
    groups.forEach((g, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = g.label;
      $('reassignTarget').append(option);
    });
    if (groups[Number(target)]) $('reassignTarget').value = target;
    $('matchGallery').replaceChildren();
    const matches = [...(group?.matches || [])];
    matches.sort(
      $('reviewSort').value === 'position'
        ? (a, b) => a.y - b.y || a.x - b.x
        : (a, b) => a.score - b.score,
    );
    const pages = Math.max(1, Math.ceil(matches.length / 12));
    reviewPage = Math.max(0, Math.min(reviewPage, pages - 1));
    $('reviewPage').textContent = `${reviewPage + 1} / ${pages}`;
    $('reviewPrev').disabled = reviewPage === 0;
    $('reviewNext').disabled = reviewPage === pages - 1;
    for (const box of matches.slice(reviewPage * 12, reviewPage * 12 + 12)) {
      const row = document.createElement('div');
      row.className = 'match-review';
      const preview = document.createElement('button');
      preview.className = 'match-preview';
      preview.title = `Locate at ${box.x}, ${box.y}`;
      const crop = document.createElement('canvas');
      crop.width = 200;
      crop.height = 70;
      const c = crop.getContext('2d'),
        scale = Math.min(190 / box.w, 60 / box.h, 6);
      c.imageSmoothingEnabled = false;
      c.drawImage(
        imageCanvas,
        box.x,
        box.y,
        box.w,
        box.h,
        (200 - box.w * scale) / 2,
        (70 - box.h * scale) / 2,
        box.w * scale,
        box.h * scale,
      );
      const caption = document.createElement('span');
      caption.textContent = `${box.manual ? 'Manual' : Math.round(box.score * 100) + '% similarity'}${box.order ? ' / route ' + box.order : ''}`;
      preview.append(crop, caption);
      preview.onclick = () => {
        showEditor();
        const r = $('stage').getBoundingClientRect();
        zoom = Math.min(
          10,
          Math.max(1, Math.min(r.width / (box.w * 4), r.height / (box.h * 4))),
        );
        offset = {
          x: r.width / 2 - (box.x + box.w / 2) * zoom,
          y: r.height / 2 - (box.y + box.h / 2) * zoom,
        };
        renderCanvas();
        setStatus(`Occurrence at ${box.x}, ${box.y}.`);
      };
      const actions = document.createElement('div');
      actions.className = 'tools';
      const remove = document.createElement('button');
      remove.textContent = 'Remove';
      remove.disabled = symbolSearch.running;
      remove.onclick = () => {
        if (symbolSearch.running) return;
        recordEdit();
        rejectMatch(group, box);
        render();
      };
      const move = document.createElement('button');
      move.textContent = 'Move to symbol';
      move.disabled = symbolSearch.running;
      move.onclick = () => {
        if (symbolSearch.running) return;
        const destination = groups[Number($('reassignTarget').value)];
        if (!destination || destination === group) return;
        recordEdit();
        rejectMatch(group, box);
        destination.matches.push({ ...box, manual: true });
        render();
      };
      actions.append(remove, move);
      const separator = document.createElement('select');
      separator.title = 'After this occurrence';
      separator.setAttribute(
        'aria-label',
        `Separator after occurrence at ${box.x}, ${box.y}`,
      );
      [
        ['', 'Default separator'],
        [' ', 'Word space'],
        ['\n', 'Line break'],
      ].forEach(([value, text]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        separator.append(option);
      });
      separator.value = box.after || '';
      separator.disabled = symbolSearch.running;
      separator.onchange = () => {
        if (symbolSearch.running) return;
        recordEdit();
        box.after = separator.value;
        render();
      };
      row.append(preview, actions, separator);
      $('matchGallery').append(row);
    }
  }
  function stopSearch() {
    if (!symbolSearch.running) return;
    symbolSearch.cancel();
    $('cancel').hidden = true;
    setStatus('Search cancelled.');
    render();
  }
  function findMatches() {
    const group = getSelectedGroup();
    if (!group || symbolSearch.running) return;
    const pixels = imageContext.getImageData(
      0,
      0,
      imageCanvas.width,
      imageCanvas.height,
    ).data;
    $('cancel').hidden = false;
    setStatus('Finding matches...');
    const finish = () => {
      $('cancel').hidden = true;
      render();
    };
    symbolSearch.start(
      {
        pixels,
        width: imageCanvas.width,
        height: imageCanvas.height,
        rect: group.rect,
        threshold: group.threshold,
        scales: group.scales ? [0.85, 1, 1.15] : [1],
        matchMode: group.matchMode,
        colorTolerance: group.colorTolerance,
        allowInverted: group.allowInverted,
      },
      {
        progress: (value) => setStatus(`Finding matches... ${value}%`),
        complete: (matches) => {
          recordEdit();
          // Retain manual corrections and route metadata when a box is found again.
          const previous = group.matches;
          group.matches = matches
            .filter(
              (b) =>
                !(group.excluded || []).some((p) => {
                  const intersection =
                    Math.max(0, Math.min(b.x + b.w, p.x + p.w) - Math.max(b.x, p.x)) *
                    Math.max(0, Math.min(b.y + b.h, p.y + p.h) - Math.max(b.y, p.y));
                  return intersection / Math.min(b.w * b.h, p.w * p.h) > 0.5;
                }),
            )
            .map((b) => {
              const old = previous.find(
                (p) => p.x === b.x && p.y === b.y && p.w === b.w && p.h === b.h,
              );
              return old ? { ...old, score: b.score } : b;
            });
          previous
            .filter((b) => b.manual || b.order !== undefined || b.after)
            .forEach((b) => {
              if (
                !group.matches.some(
                  (m) => m.x === b.x && m.y === b.y && m.w === b.w && m.h === b.h,
                )
              )
                group.matches.push(b);
            });
          setStatus(`${matches.length} matches found.`);
          finish();
        },
        error: (error) => {
          setStatus('Search failed: ' + error);
          finish();
        },
      },
    );
    render();
  }
  async function decodeImage(url) {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Unable to open image.'));
      image.src = url;
    });
    if (image.width * image.height > TranscriberProject.MAX_IMAGE_PIXELS) {
      throw new Error('Image exceeds 18 megapixels. Resize it before uploading.');
    }
    return image;
  }
  function commitImage(
    image,
    name,
    nextGroups = [],
    nextReading = TranscriberProject.validateReading(),
  ) {
    // Validate and decode before this point; failed imports must not erase the editor.
    stopSearch();
    drag = null;
    imageCanvas.width = image.width;
    imageCanvas.height = image.height;
    imageContext.drawImage(image, 0, 0);
    groups = nextGroups;
    reading = nextReading;
    reviewPage = 0;
    setMode('select');
    selected = groups.length ? 0 : -1;
    editHistory.clear();
    imageName = name;
    $('filename').textContent = name;
    $('dimensions').textContent = `${imageCanvas.width} × ${imageCanvas.height} px`;
    $('uploadEmpty').hidden = true;
    $('export').disabled = false;
    render();
    showEditor();
    fitImageToViewport();
  }
  async function openFile(file) {
    if (!file) return;
    const request = ++loadRequest;
    const url = URL.createObjectURL(file);
    try {
      const image = await decodeImage(url);
      if (request !== loadRequest) return;
      commitImage(image, file.name);
      setStatus('Draw a box around a symbol.');
    } catch (error) {
      if (request === loadRequest) setStatus(error.message);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function importProject(file) {
    if (!file) return;
    const request = ++loadRequest;
    try {
      if (file.size > TranscriberProject.MAX_PROJECT_BYTES)
        throw new Error('Project file is too large.');
      const project = TranscriberProject.parseProject(await file.text());
      const image = await decodeImage(project.image);
      const nextGroups = TranscriberProject.validateGroups(
        project.groups,
        image.width,
        image.height,
      );
      const nextReading = TranscriberProject.validateReading(project.reading);
      if (request !== loadRequest) return;
      commitImage(image, project.name, nextGroups, nextReading);
      setStatus('Project restored.');
    } catch (error) {
      if (request === loadRequest) setStatus('Unable to load: ' + error.message);
    }
  }
  function updateText() {
    $('text').value = TranscriberProject.transcribe(groups, reading.tolerance, reading);
  }
  function downloadFile(blob, name) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function showEditor() {
    $('stage').hidden = false;
    $('transcription').hidden = true;
    $('editorTab').classList.add('active');
    $('textTab').classList.remove('active');
    resize();
  }
  $('textTab').onclick = () => {
    $('stage').hidden = true;
    $('transcription').hidden = false;
    $('editorTab').classList.remove('active');
    $('textTab').classList.add('active');
    updateText();
  };
  $('editorTab').onclick = showEditor;
  $('open').onclick = () => $('file').click();
  $('file').onchange = (event) => {
    openFile(event.target.files[0]);
    event.target.value = '';
  };
  $('uploadEmpty').onclick = () => $('file').click();
  ['select', 'pan', 'erase', 'manual', 'route'].forEach(
    (m) =>
      ($(m).onclick = () => {
        showEditor();
        setMode(m);
        if (m === 'route') {
          recordEdit();
          reading.mode = 'custom';
          render();
          setStatus('Click occurrences in reading order. Click again to remove.');
        }
        if (m === 'manual')
          setStatus('Draw a missing occurrence of the selected symbol.');
      }),
  );
  $('newSymbol').onclick = () => {
    showEditor();
    setMode('select');
    setStatus('Draw a box to add a sample.');
  };
  $('fit').onclick = fitImageToViewport;
  ['plus', 'minus'].forEach(
    (id) =>
      ($(id).onclick = () => {
        const r = $('stage').getBoundingClientRect();
        zoomAt(id === 'plus' ? 1.25 : 0.8, r.width / 2, r.height / 2);
      }),
  );
  $('undo').onclick = () => restoreEdit('undo');
  $('redo').onclick = () => restoreEdit('redo');
  $('search').onclick = findMatches;
  $('cancel').onclick = stopSearch;
  $('threshold').oninput = () => {
    $('thresholdValue').textContent = $('threshold').value + '%';
    if (getSelectedGroup())
      getSelectedGroup().threshold = Number($('threshold').value) / 100;
  };
  $('scales').onchange = () => {
    if (getSelectedGroup()) getSelectedGroup().scales = $('scales').checked;
  };
  $('matchMode').onchange = () => {
    const group = getSelectedGroup();
    if (!group) return;
    recordEdit();
    group.matchMode = $('matchMode').value;
    if (group.matchMode === 'color') group.allowInverted = false;
    render();
    setStatus('Matching settings changed. Click Find matches to update results.');
  };
  $('colorTolerance').oninput = () => {
    $('colorToleranceValue').textContent = $('colorTolerance').value + '%';
  };
  $('colorTolerance').onchange = () => {
    const group = getSelectedGroup();
    if (!group) return;
    recordEdit();
    group.colorTolerance = Number($('colorTolerance').value) / 100;
    setStatus('Matching settings changed. Click Find matches to update results.');
  };
  $('allowInverted').onchange = () => {
    const group = getSelectedGroup();
    if (!group) return;
    recordEdit();
    group.allowInverted = $('allowInverted').checked;
    setStatus('Matching settings changed. Click Find matches to update results.');
  };
  ['label', 'color'].forEach(
    (id) =>
      ($(id).onchange = () => {
        if (!getSelectedGroup()) return;
        recordEdit();
        getSelectedGroup()[id] = $(id).value || '?';
        render();
      }),
  );
  ['labels', 'boxes'].forEach((id) => ($(id).onchange = renderCanvas));
  $('deleteClass').onclick = () => {
    if (!getSelectedGroup()) return;
    recordEdit();
    groups.splice(selected, 1);
    selected = Math.min(selected, groups.length - 1);
    render();
  };
  $('rowTolerance').oninput = () => {
    $('rowValue').textContent = $('rowTolerance').value + '%';
  };
  for (const id of ['readingMode', 'tokenSeparator', 'lineBreaks', 'rowTolerance'])
    $(id).onchange = () => {
      recordEdit();
      reading = TranscriberProject.validateReading({
        mode: $('readingMode').value,
        separator: $('tokenSeparator').value,
        lineBreaks: $('lineBreaks').checked,
        tolerance: Number($('rowTolerance').value) / 100,
      });
      render();
    };
  $('clearRoute').onclick = () => {
    if (symbolSearch.running) return;
    recordEdit();
    groups.forEach((g) => g.matches.forEach((b) => delete b.order));
    render();
  };
  $('resetExcluded').onclick = () => {
    const g = getSelectedGroup();
    if (!g || symbolSearch.running) return;
    recordEdit();
    delete g.excluded;
    render();
    setStatus('Rejections cleared. Click Find matches to search again.');
  };
  $('reviewSort').onchange = () => {
    reviewPage = 0;
    renderReview();
  };
  $('reviewPrev').onclick = () => {
    reviewPage--;
    renderReview();
  };
  $('reviewNext').onclick = () => {
    reviewPage++;
    renderReview();
  };
  $('exportText').onclick = () =>
    downloadFile(
      new Blob([$('text').value], { type: 'text/plain;charset=utf-8' }),
      'transcriber.txt',
    );
  $('copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('text').value);
      setStatus('Text copied.');
    } catch {
      $('text').select();
      setStatus('Press Ctrl+C to copy the selected text.');
    }
  };
  $('export').onclick = () => $('exportDialog').showModal();
  $('closeExport').onclick = () => $('exportDialog').close();
  $('exportPng').onclick = () => {
    const c = document.createElement('canvas');
    c.width = imageCanvas.width;
    c.height = imageCanvas.height;
    const d = c.getContext('2d');
    d.drawImage(imageCanvas, 0, 0);
    groups.forEach((g) =>
      g.matches.forEach((b) => drawMatchBox(d, b, g.color, g.label, 1)),
    );
    c.toBlob((blob) => {
      if (blob) downloadFile(blob, 'transcriber-annotated.png');
      else setStatus('Unable to export image.');
    });
  };
  $('exportCsv').onclick = () => {
    const csv = TranscriberProject.exportCsv(groups);
    downloadFile(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      'transcriber-symbols.csv',
    );
  };
  $('saveProject').onclick = () =>
    downloadFile(
      new Blob(
        [
          JSON.stringify({
            version: 1,
            image: imageCanvas.toDataURL(),
            name: imageName,
            groups,
            reading,
          }),
        ],
        { type: 'application/json' },
      ),
      'transcriber-project.json',
    );
  $('loadProject').onclick = () => $('projectFile').click();
  $('projectFile').onchange = (event) => {
    importProject(event.target.files[0]);
    event.target.value = '';
  };
  const stage = $('stage');
  stage.ondragover = (e) => {
    e.preventDefault();
    stage.classList.add('dragover');
  };
  stage.ondragleave = () => stage.classList.remove('dragover');
  stage.ondrop = (e) => {
    e.preventDefault();
    stage.classList.remove('dragover');
    openFile(e.dataTransfer.files[0]);
  };
  document.addEventListener('paste', (e) => {
    const item = [...e.clipboardData.items].find((x) => x.type.startsWith('image/'));
    if (item) openFile(item.getAsFile());
  });
  document.addEventListener('keydown', (e) => {
    if (
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) ||
      e.target.isContentEditable
    )
      return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        restoreEdit(e.shiftKey ? 'redo' : 'undo');
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        restoreEdit('redo');
      }
      return;
    }
    if (e.key === 'b') setMode('select');
    if (e.key === 'h') setMode('pan');
    if (e.key === 'e') setMode('erase');
    if (e.key === 'Escape') {
      drag = null;
      stopSearch();
      renderCanvas();
    }
  });
  imageCanvas.width = 0;
  imageCanvas.height = 0;
  new ResizeObserver(resize).observe(stage);
  render();
})();
