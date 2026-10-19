/**
 * domRenderer.ts
 * Fonctions de rendu : elles lisent l'état reçu en paramètre et mettent à jour
 * le DOM, sans jamais modifier les données. Le contenu saisi par l'utilisateur
 * est toujours inséré via textContent (jamais innerHTML) pour éviter les failles XSS.
 */

import {
  canCancel,
  findBookingAt,
  generateDaySlots,
  generateDayTimes,
  getUpcomingBookingsForUser,
  occupancyRate,
  timeToMinutes,
} from './bookingService.js';
import {
  Booking,
  Equipment,
  EQUIPMENT_LABELS,
  MessageType,
  Room,
  SCHEDULE,
  TimeSlot,
  User,
} from './types.js';

/* ------------------------------------------------------------------ */
/* Utilitaires DOM typés                                               */
/* ------------------------------------------------------------------ */

/**
 * Récupère un élément par son id en vérifiant son type réel.
 * Une erreur explicite est préférable à un null silencieux plus loin dans le code.
 */
export function getElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`Élément #${id} introuvable ou de type inattendu.`);
  }
  return element;
}

interface ElementOptions {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
  dataset?: Record<string, string>;
}

/** Fabrique d'éléments : crée une balise typée avec classes, texte et attributs. */
function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: Node[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options.className !== undefined) {
    element.className = options.className;
  }
  if (options.text !== undefined) {
    element.textContent = options.text;
  }
  if (options.attrs !== undefined) {
    Object.entries(options.attrs).forEach(([name, value]) => element.setAttribute(name, value));
  }
  if (options.dataset !== undefined) {
    Object.entries(options.dataset).forEach(([key, value]) => {
      element.dataset[key] = value;
    });
  }
  children.forEach((child) => element.appendChild(child));
  return element;
}

/** Références vers les éléments de l'interface, résolues une seule fois au démarrage. */
export interface UiElements {
  userSelect: HTMLSelectElement;
  resetButton: HTMLButtonElement;
  datePicker: HTMLInputElement;
  prevDay: HTMLButtonElement;
  nextDay: HTMLButtonElement;
  todayButton: HTMLButtonElement;
  capacityFilter: HTMLInputElement;
  capacityOutput: HTMLOutputElement;
  equipmentFilters: HTMLDivElement;
  clearFilters: HTMLButtonElement;
  myBookings: HTMLUListElement;
  planningTitle: HTMLHeadingElement;
  planningSubtitle: HTMLParagraphElement;
  planning: HTMLDivElement;
  planningEmpty: HTMLParagraphElement;
  newBookingButton: HTMLButtonElement;
  dialog: HTMLDialogElement;
  dialogTitle: HTMLHeadingElement;
  form: HTMLFormElement;
  formErrors: HTMLDivElement;
  titleInput: HTMLInputElement;
  roomSelect: HTMLSelectElement;
  roomDetails: HTMLParagraphElement;
  dateInput: HTMLInputElement;
  attendeesInput: HTMLInputElement;
  startSelect: HTMLSelectElement;
  endSelect: HTMLSelectElement;
  toastRegion: HTMLDivElement;
}

export function queryUiElements(): UiElements {
  return {
    userSelect: getElement('current-user', HTMLSelectElement),
    resetButton: getElement('reset-data', HTMLButtonElement),
    datePicker: getElement('date-picker', HTMLInputElement),
    prevDay: getElement('prev-day', HTMLButtonElement),
    nextDay: getElement('next-day', HTMLButtonElement),
    todayButton: getElement('today-btn', HTMLButtonElement),
    capacityFilter: getElement('capacity-filter', HTMLInputElement),
    capacityOutput: getElement('capacity-output', HTMLOutputElement),
    equipmentFilters: getElement('equipment-filters', HTMLDivElement),
    clearFilters: getElement('clear-filters', HTMLButtonElement),
    myBookings: getElement('my-bookings', HTMLUListElement),
    planningTitle: getElement('planning-title', HTMLHeadingElement),
    planningSubtitle: getElement('planning-subtitle', HTMLParagraphElement),
    planning: getElement('planning', HTMLDivElement),
    planningEmpty: getElement('planning-empty', HTMLParagraphElement),
    newBookingButton: getElement('new-booking', HTMLButtonElement),
    dialog: getElement('booking-dialog', HTMLDialogElement),
    dialogTitle: getElement('dialog-title', HTMLHeadingElement),
    form: getElement('booking-form', HTMLFormElement),
    formErrors: getElement('form-errors', HTMLDivElement),
    titleInput: getElement('booking-title', HTMLInputElement),
    roomSelect: getElement('booking-room', HTMLSelectElement),
    roomDetails: getElement('room-details', HTMLParagraphElement),
    dateInput: getElement('booking-date', HTMLInputElement),
    attendeesInput: getElement('booking-attendees', HTMLInputElement),
    startSelect: getElement('booking-start', HTMLSelectElement),
    endSelect: getElement('booking-end', HTMLSelectElement),
    toastRegion: getElement('toast-region', HTMLDivElement),
  };
}

/* ------------------------------------------------------------------ */
/* Formatage                                                           */
/* ------------------------------------------------------------------ */

const longDateFormatter = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const shortDateFormatter = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** Construit une Date locale à partir de "YYYY-MM-DD" (évite le décalage UTC de new Date(iso)). */
export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export function formatLongDate(iso: string): string {
  return longDateFormatter.format(parseIsoDate(iso));
}

function formatShortDate(iso: string): string {
  return shortDateFormatter.format(parseIsoDate(iso));
}

function formatEquipments(equipments: readonly Equipment[]): string {
  return equipments.length === 0 ? 'Aucun équipement' : equipments.map((eq) => EQUIPMENT_LABELS[eq]).join(', ');
}

/* ------------------------------------------------------------------ */
/* Contrôles d'en-tête et filtres                                      */
/* ------------------------------------------------------------------ */

export function renderUserSelect(select: HTMLSelectElement, users: readonly User[], currentUserId: string): void {
  select.replaceChildren(
    ...users.map((user) => {
      const option = createEl('option', { text: `${user.name} — ${user.department}`, attrs: { value: user.id } });
      option.selected = user.id === currentUserId;
      return option;
    }),
  );
}

export function renderEquipmentFilters(container: HTMLDivElement, selected: readonly Equipment[]): void {
  const items = Object.values(Equipment).map((equipment) => {
    const input = createEl('input', { attrs: { type: 'checkbox', name: 'equipment', value: equipment } });
    input.checked = selected.includes(equipment);
    return createEl('label', { className: 'checkbox' }, [input, document.createTextNode(EQUIPMENT_LABELS[equipment])]);
  });
  container.replaceChildren(...items);
}

/* ------------------------------------------------------------------ */
/* Planning                                                            */
/* ------------------------------------------------------------------ */

export interface PlanningContext {
  rooms: readonly Room[];
  totalRooms: number;
  bookings: readonly Booking[];
  users: readonly User[];
  currentUser: User;
  date: string;
  now: Date;
  highlightBookingId?: string;
}

/** Colonne CSS Grid d'une heure : la colonne 1 est réservée au nom de la salle. */
function timeToGridColumn(time: string): number {
  return (timeToMinutes(time) - SCHEDULE.openingMinutes) / SCHEDULE.slotMinutes + 2;
}

function isSlotPast(date: string, slot: TimeSlot, now: Date): boolean {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (date !== today) {
    return date < today;
  }
  return timeToMinutes(slot.start) < now.getHours() * 60 + now.getMinutes();
}

function renderHeaderRow(slotCount: number): HTMLDivElement {
  const row = createEl('div', { className: 'planning-row planning-row--header', attrs: { 'aria-hidden': 'true' } });
  row.appendChild(createEl('div', { className: 'room-cell', text: 'Salle' }));
  // Une étiquette par heure pleine, couvrant deux colonnes de 30 minutes.
  generateDayTimes()
    .filter((time) => time.endsWith(':00'))
    .forEach((time) => {
      const column = timeToGridColumn(time);
      if (column - 2 < slotCount) {
        const label = createEl('div', { className: 'planning-hour', text: time });
        label.style.gridColumn = `${column} / span 2`;
        row.appendChild(label);
      }
    });
  return row;
}

function renderRoomCell(room: Room, rate: number): HTMLDivElement {
  const bar = createEl('span', { className: 'room-cell__occupancy-bar' });
  bar.style.width = `${Math.round(rate * 100)}%`;
  return createEl('div', { className: 'room-cell', attrs: { title: room.description } }, [
    createEl('span', { className: 'room-cell__name', text: room.name }),
    createEl('span', { className: 'room-cell__meta', text: `${room.capacity} pers. · Étage ${room.floor}` }),
    createEl('span', { className: 'room-cell__occupancy', attrs: { title: `Occupation : ${Math.round(rate * 100)} %` } }, [bar]),
  ]);
}

function renderBookingBlock(booking: Booking, ctx: PlanningContext): HTMLButtonElement {
  const owner = ctx.users.find((u) => u.id === booking.userId);
  const ownerName = owner?.name ?? 'Utilisateur inconnu';
  const isMine = booking.userId === ctx.currentUser.id;
  const cancellable = canCancel(booking, ctx.currentUser);

  const block = createEl(
    'button',
    {
      className: `booking-block${isMine ? ' booking-block--mine' : ''}`,
      attrs: {
        type: 'button',
        title: `${booking.title}\n${booking.slot.start} – ${booking.slot.end} · ${ownerName} · ${booking.attendees} pers.`,
        'aria-label': `Occupé de ${booking.slot.start} à ${booking.slot.end} : ${booking.title}, réservé par ${ownerName}.${cancellable ? ' Activer pour annuler.' : ''}`,
      },
      dataset: { action: 'booking', bookingId: booking.id },
    },
    [
      createEl('span', { className: 'booking-block__title', text: booking.title }),
      createEl('span', { className: 'booking-block__meta', text: `${booking.slot.start}–${booking.slot.end} · ${ownerName}` }),
    ],
  );
  block.style.gridColumn = `${timeToGridColumn(booking.slot.start)} / ${timeToGridColumn(booking.slot.end)}`;
  if (booking.id === ctx.highlightBookingId) {
    block.classList.add('booking-block--flash');
  }
  return block;
}

/**
 * Rendu complet du planning : une ligne par salle filtrée.
 * Pour chaque créneau de 30 min, on affiche soit un bouton "libre",
 * soit (une seule fois) le bloc de la réservation qui l'occupe.
 */
export function renderPlanning(ui: UiElements, ctx: PlanningContext): void {
  const daySlots = generateDaySlots();
  ui.planning.style.setProperty('--slot-count', String(daySlots.length));

  ui.planningTitle.textContent = formatLongDate(ctx.date);
  const dayBookings = ctx.bookings.filter((b) => b.date === ctx.date);
  ui.planningSubtitle.textContent =
    `${ctx.rooms.length} salle(s) affichée(s) sur ${ctx.totalRooms} · ` +
    `${dayBookings.length} réservation(s) ce jour · cliquez sur un créneau libre pour réserver.`;

  ui.planningEmpty.hidden = ctx.rooms.length > 0;
  if (ctx.rooms.length === 0) {
    ui.planning.replaceChildren();
    return;
  }

  const rows: HTMLDivElement[] = [renderHeaderRow(daySlots.length)];

  ctx.rooms.forEach((room) => {
    const row = createEl('div', {
      className: 'planning-row',
      attrs: { role: 'group', 'aria-label': `Salle ${room.name}, ${room.capacity} personnes, étage ${room.floor}` },
    });
    row.appendChild(renderRoomCell(room, occupancyRate(ctx.bookings, room.id, ctx.date)));

    const renderedBookings = new Set<string>();
    daySlots.forEach((slot) => {
      const booking = findBookingAt(ctx.bookings, room.id, ctx.date, slot);
      if (booking !== undefined) {
        if (!renderedBookings.has(booking.id)) {
          renderedBookings.add(booking.id);
          row.appendChild(renderBookingBlock(booking, ctx));
        }
        return;
      }

      const past = isSlotPast(ctx.date, slot, ctx.now);
      const button = createEl('button', {
        className: `slot${slot.start.endsWith(':00') ? ' slot--hour-start' : ''}${past ? ' slot--past' : ''}`,
        attrs: {
          type: 'button',
          'aria-label': past
            ? `${room.name}, ${slot.start} – ${slot.end} : créneau passé`
            : `Réserver ${room.name} à ${slot.start}`,
          title: past ? 'Créneau passé' : `Réserver ${room.name} à ${slot.start}`,
        },
        dataset: { action: 'book', roomId: room.id, start: slot.start },
      });
      button.disabled = past;
      button.style.gridColumn = String(timeToGridColumn(slot.start));
      row.appendChild(button);
    });

    rows.push(row);
  });

  ui.planning.replaceChildren(...rows);
}

/* ------------------------------------------------------------------ */
/* Liste "Mes prochaines réservations"                                 */
/* ------------------------------------------------------------------ */

export function renderMyBookings(
  list: HTMLUListElement,
  bookings: readonly Booking[],
  rooms: readonly Room[],
  user: User,
  now: Date,
): void {
  const upcoming = getUpcomingBookingsForUser(bookings, user.id, now);
  if (upcoming.length === 0) {
    list.replaceChildren(createEl('li', { className: 'booking-list__empty', text: 'Aucune réservation à venir.' }));
    return;
  }

  list.replaceChildren(
    ...upcoming.map((booking) => {
      const room = rooms.find((r) => r.id === booking.roomId);
      const info = createEl('div', {}, [
        createEl('p', { className: 'booking-item__title', text: booking.title }),
        createEl('p', {
          className: 'booking-item__meta',
          text: `${formatShortDate(booking.date)} · ${booking.slot.start}–${booking.slot.end} · ${room?.name ?? 'Salle supprimée'}`,
        }),
      ]);
      const cancel = createEl('button', {
        className: 'btn btn--danger-link',
        text: 'Annuler',
        attrs: { type: 'button', 'aria-label': `Annuler la réservation « ${booking.title} »` },
        dataset: { action: 'cancel', bookingId: booking.id },
      });
      return createEl('li', { className: 'booking-item' }, [info, cancel]);
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Formulaire de réservation                                           */
/* ------------------------------------------------------------------ */

export interface DialogPrefill {
  roomId: string;
  date: string;
  start: string;
}

function fillTimeSelect(select: HTMLSelectElement, times: readonly string[], selected: string): void {
  select.replaceChildren(
    ...times.map((time) => {
      const option = createEl('option', { text: time, attrs: { value: time } });
      option.selected = time === selected;
      return option;
    }),
  );
}

/** Met à jour les heures de fin possibles : strictement après le début, dans la limite de durée. */
export function updateEndOptions(ui: UiElements, preferredEnd?: string): void {
  const start = ui.startSelect.value;
  if (start === '') {
    return;
  }
  const startMin = timeToMinutes(start);
  const candidates = generateDayTimes().filter((time) => {
    const m = timeToMinutes(time);
    return m > startMin && m - startMin <= SCHEDULE.maxDurationMinutes;
  });
  const defaultEnd = candidates.find((t) => timeToMinutes(t) - startMin === 60) ?? candidates[0] ?? '';
  const wanted = preferredEnd !== undefined && candidates.includes(preferredEnd) ? preferredEnd : defaultEnd;
  fillTimeSelect(ui.endSelect, candidates, wanted);
}

export function updateRoomDetails(ui: UiElements, rooms: readonly Room[]): void {
  const room = rooms.find((r) => r.id === ui.roomSelect.value);
  ui.roomDetails.textContent = room === undefined
    ? ''
    : `${room.capacity} places · Étage ${room.floor} · ${formatEquipments(room.equipments)}`;
  if (room !== undefined) {
    ui.attendeesInput.max = String(room.capacity);
  }
}

export function openBookingDialog(ui: UiElements, rooms: readonly Room[], prefill: DialogPrefill): void {
  clearFormErrors(ui);
  ui.form.reset();

  ui.roomSelect.replaceChildren(
    ...rooms.map((room) => {
      const option = createEl('option', { text: `${room.name} (${room.capacity} pers.)`, attrs: { value: room.id } });
      option.selected = room.id === prefill.roomId;
      return option;
    }),
  );
  ui.dateInput.value = prefill.date;
  ui.attendeesInput.value = '2';

  const startTimes = generateDayTimes().slice(0, -1);
  fillTimeSelect(ui.startSelect, startTimes, prefill.start);
  updateEndOptions(ui);
  updateRoomDetails(ui, rooms);

  ui.dialogTitle.textContent = 'Nouvelle réservation';
  if (!ui.dialog.open) {
    ui.dialog.showModal();
  }
  ui.titleInput.focus();
}

export function closeBookingDialog(ui: UiElements): void {
  if (ui.dialog.open) {
    ui.dialog.close();
  }
}

export function showFormErrors(ui: UiElements, errors: readonly string[]): void {
  const heading = createEl('strong', { text: errors.length > 1 ? 'La réservation est refusée :' : 'La réservation est refusée.' });
  const list = createEl('ul', {}, errors.map((error) => createEl('li', { text: error })));
  ui.formErrors.replaceChildren(heading, list);
  ui.formErrors.hidden = false;

  // Marque visuellement les champs horaires si un conflit est en cause.
  const timeIssue = errors.some((e) => e.includes('Conflit') || e.includes('heure') || e.includes('horaire') || e.includes('passé'));
  ui.startSelect.setAttribute('aria-invalid', String(timeIssue));
  ui.endSelect.setAttribute('aria-invalid', String(timeIssue));
  ui.titleInput.setAttribute('aria-invalid', String(errors.some((e) => e.includes('objet'))));
  ui.attendeesInput.setAttribute('aria-invalid', String(errors.some((e) => e.includes('participants') || e.includes('maximum'))));
}

export function clearFormErrors(ui: UiElements): void {
  ui.formErrors.hidden = true;
  ui.formErrors.replaceChildren();
  [ui.startSelect, ui.endSelect, ui.titleInput, ui.attendeesInput].forEach((field) => field.removeAttribute('aria-invalid'));
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

const TOAST_DURATION_MS = 4500;

export function showToast(region: HTMLDivElement, message: string, type: MessageType = MessageType.Info): void {
  const toast = createEl('div', {
    className: `toast toast--${type}`,
    text: message,
    attrs: { role: type === MessageType.Error ? 'alert' : 'status' },
  });
  region.appendChild(toast);

  window.setTimeout(() => {
    toast.classList.add('toast--leaving');
    window.setTimeout(() => toast.remove(), 300);
  }, TOAST_DURATION_MS);
}
