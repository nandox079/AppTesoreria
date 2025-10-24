const records = [];
let maxUploadSize = 5 * 1024 * 1024;

const selectors = {
  form: document.getElementById('recordForm'),
  alert: document.getElementById('formAlert'),
  eventSelect: document.getElementById('eventSelect'),
  conceptInput: document.getElementById('conceptInput'),
  amountInput: document.getElementById('amountInput'),
  receiptInput: document.getElementById('receiptInput'),
  previewImage: document.getElementById('imagePreview'),
  previewEvent: document.getElementById('previewEvent'),
  previewConcept: document.getElementById('previewConcept'),
  previewAmount: document.getElementById('previewAmount'),
  previewValidation: document.getElementById('previewValidation'),
  recordsTable: document.getElementById('recordsTable'),
};

let cachedEvents = [];
let backendMode = 'live';

async function loadEvents() {
  const response = await fetch('/api/events', { cache: 'no-store' });
  if (!response.ok) {
    const errorText = await safeReadError(response);
    throw new Error(errorText || 'No se pudo cargar la lista de eventos.');
  }
  const data = await response.json();
  if (!data || !Array.isArray(data.events) || data.events.length === 0) {
    throw new Error('No se encontraron eventos disponibles en la hoja.');
  }
  return {
    events: data.events,
    maxImageSize: Number.parseInt(data.maxImageSize, 10) || null,
    mode: data.mode || 'live',
  };
}

async function safeReadError(response) {
  try {
    const data = await response.json();
    return data?.error || data?.message || '';
  } catch (error) {
    return '';
  }
}

function populateEventSelect(events) {
  selectors.eventSelect.innerHTML =
    '<option value="" disabled selected>Selecciona un evento</option>';
  events.forEach((event) => {
    const option = document.createElement('option');
    option.value = event.id;
    option.textContent = event.rawBudget
      ? `${event.name} (Ppto: ${event.rawBudget})`
      : event.name;
    selectors.eventSelect.appendChild(option);
  });
}

function setAlert(type, message) {
  if (!selectors.alert) return;
  selectors.alert.textContent = message;
  selectors.alert.className = `alert ${type === 'error' ? 'error' : 'success'}`;
  selectors.alert.hidden = false;
}

function clearAlert() {
  if (!selectors.alert) return;
  selectors.alert.textContent = '';
  selectors.alert.hidden = true;
  selectors.alert.className = 'alert';
}

function resetPreview() {
  selectors.previewImage.innerHTML = '<span>Selecciona un archivo para ver la vista previa</span>';
  selectors.previewEvent.textContent = '—';
  selectors.previewConcept.textContent = '—';
  selectors.previewAmount.textContent = '—';
  selectors.previewValidation.textContent = 'Sin validar';
}

function renderTable() {
  const tbody = selectors.recordsTable.querySelector('tbody');
  tbody.innerHTML = '';

  if (!records.length) {
    const emptyRow = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = 'Aún no hay registros cargados.';
    cell.className = 'empty';
    emptyRow.appendChild(cell);
    tbody.appendChild(emptyRow);
    return;
  }

  records.forEach((record) => {
    const row = document.createElement('tr');

    const eventCell = document.createElement('td');
    eventCell.textContent = record.eventBudget
      ? `${record.eventName} (Ppto: ${record.eventBudget})`
      : record.eventName;
    row.appendChild(eventCell);

    const conceptCell = document.createElement('td');
    conceptCell.textContent = record.concept;
    row.appendChild(conceptCell);

    const amountCell = document.createElement('td');
    amountCell.textContent = `$ ${Number(record.amount).toFixed(2)}`;
    row.appendChild(amountCell);

    const fileCell = document.createElement('td');
    if (record.driveFile?.webViewLink) {
      const link = document.createElement('a');
      link.href = record.driveFile.webViewLink;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = record.driveFile.name || record.driveFile.id;
      fileCell.appendChild(link);
    } else {
      fileCell.textContent = record.driveFile?.name || '—';
    }
    row.appendChild(fileCell);

    const statusCell = document.createElement('td');
    const isWarning = record.validationStatus.toLowerCase().includes('revisión');
    statusCell.className = `badge ${isWarning ? 'badge-warning' : 'badge-success'}`;
    statusCell.textContent = record.validationStatus;
    row.appendChild(statusCell);

    tbody.appendChild(row);
  });
}

function updatePreview({ eventName, eventBudget, concept, amount, validationStatus }) {
  if (eventName && eventBudget) {
    selectors.previewEvent.textContent = `${eventName} (Ppto: ${eventBudget})`;
  } else {
    selectors.previewEvent.textContent = eventName || '—';
  }
  selectors.previewConcept.textContent = concept || '—';
  selectors.previewAmount.textContent = amount ? `$ ${Number(amount).toFixed(2)}` : '—';
  selectors.previewValidation.textContent = validationStatus || 'Sin validar';
}

function handleFilePreview(file) {
  if (!file) {
    resetPreview();
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    selectors.previewImage.innerHTML = '';
    const img = document.createElement('img');
    img.src = reader.result;
    img.alt = `Comprobante ${file.name}`;
    selectors.previewImage.appendChild(img);
  };
  reader.readAsDataURL(file);
}

function validateForm({ eventId, concept, amount, file }) {
  if (!eventId) {
    throw new Error('Selecciona un evento.');
  }
  if (!concept.trim()) {
    throw new Error('Ingresa un concepto.');
  }
  if (Number.isNaN(amount) || amount <= 0) {
    throw new Error('El valor debe ser mayor a cero.');
  }
  if (!file) {
    throw new Error('Selecciona una imagen del comprobante.');
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('El archivo debe ser una imagen válida.');
  }
  if (file.size > maxUploadSize) {
    const limitMb = (maxUploadSize / (1024 * 1024)).toFixed(1);
    throw new Error(`El archivo supera el límite de ${limitMb} MB configurado en el servidor.`);
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('No se pudo leer el archivo.'));
        return;
      }
      const base64 = result.substring(result.indexOf(',') + 1);
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('No se pudo procesar la imagen.'));
    reader.readAsDataURL(file);
  });
}

async function handleSubmit(event) {
  event.preventDefault();
  clearAlert();

  if (!cachedEvents.length) {
    setAlert('error', 'La lista de eventos no está disponible.');
    return;
  }

  const formData = new FormData(selectors.form);
  const selectedEventId = formData.get('eventSelect') || selectors.eventSelect.value;
  const selectedEvent = cachedEvents.find((evt) => evt.id === selectedEventId);
  const concept = selectors.conceptInput.value;
  const amount = Number.parseFloat(selectors.amountInput.value);
  const file = selectors.receiptInput.files?.[0] ?? null;

  try {
    validateForm({ eventId: selectedEventId, concept, amount, file });
  } catch (validationError) {
    setAlert('error', validationError.message);
    return;
  }

  selectors.previewEvent.textContent = selectedEvent?.rawBudget
    ? `${selectedEvent.name} (Ppto: ${selectedEvent.rawBudget})`
    : selectedEvent?.name ?? '—';
  selectors.previewConcept.textContent = concept;
  selectors.previewAmount.textContent = `$ ${amount.toFixed(2)}`;
  selectors.previewValidation.textContent = 'Validando…';

  try {
    const base64 = await fileToBase64(file);
    const response = await fetch('/api/vouchers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventId: selectedEventId,
        concept,
        amount,
        file: {
          name: file.name,
          type: file.type,
          size: file.size,
          base64,
        },
      }),
    });

    if (!response.ok) {
      const errorMessage = await safeReadError(response);
      throw new Error(errorMessage || 'No se pudo guardar el comprobante.');
    }

    const result = await response.json();
    const record = result.record;
    if (!record) {
      throw new Error('La respuesta del servidor está incompleta.');
    }

    records.unshift({
      ...record,
      eventBudget: selectedEvent?.rawBudget || null,
    });
    renderTable();
    updatePreview({
      ...record,
      eventBudget: selectedEvent?.rawBudget || null,
    });
    const successMessages = [
      result.message,
      result.budgetStatus?.message,
      result.mode === 'mock' ? 'Modo demo: el archivo se guardó en el servidor local.' : null,
    ]
      .filter(Boolean)
      .join(' ');
    setAlert('success', successMessages || 'Comprobante guardado correctamente.');

    selectors.form.reset();
  } catch (error) {
    selectors.previewValidation.textContent = 'Sin validar';
    setAlert('error', error.message);
    console.error('Error al enviar el formulario:', error);
  }
}

async function init() {
  resetPreview();
  updateFileSizeHint(maxUploadSize);

  try {
    const { events, maxImageSize, mode } = await loadEvents();
    cachedEvents = events;
    backendMode = mode;
    if (maxImageSize) {
      maxUploadSize = maxImageSize;
      updateFileSizeHint(maxUploadSize);
    }
    populateEventSelect(cachedEvents);
    if (backendMode === 'mock') {
      setAlert(
        'success',
        'Estás en modo demo: los datos provienen de ejemplos y los archivos se guardan localmente.'
      );
    }
  } catch (error) {
    setAlert('error', error.message);
    selectors.form.querySelector('button[type="submit"]').disabled = true;
    return;
  }

  selectors.receiptInput.addEventListener('change', (evt) => {
    const file = evt.target.files?.[0];
    handleFilePreview(file);
  });

  selectors.form.addEventListener('reset', () => {
    clearAlert();
    resetPreview();
  });

  selectors.form.addEventListener('submit', handleSubmit);
}

init();

function updateFileSizeHint(size) {
  const limitMb = (size / (1024 * 1024)).toFixed(1);
  const hint = selectors.receiptInput?.closest('.field')?.querySelector('.hint');
  if (hint) {
    hint.textContent = `Formatos admitidos: JPG, PNG o HEIC. Tamaño máximo permitido: ${limitMb} MB.`;
  }
}
