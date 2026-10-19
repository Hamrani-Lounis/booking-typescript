/**
 * main.ts
 * Point d'entrée : initialise l'état, branche les écouteurs d'événements
 * et orchestre les appels entre la couche métier, le stockage et le rendu.
 * C'est le seul module autorisé à modifier l'état de l'application.
 */

import {
  canCancel,
  cancelBooking,
  createBooking,
  filterRooms,
  suggestAlternativeRooms,
} from './bookingService.js';
import {
  closeBookingDialog,
  formatLongDate,
  openBookingDialog,
  parseIsoDate,
  queryUiElements,
  renderEquipmentFilters,
  renderMyBookings,
  renderPlanning,
  renderUserSelect,
  showFormErrors,
  showToast,
  UiElements,
  updateEndOptions,
  updateRoomDetails,
} from './domRenderer.js';
import {
  loadBookings,
  loadCurrentUserId,
  loadRooms,
  loadUsers,
  resetStorage,
  saveBookings,
  saveCurrentUserId,
  toIsoDate,
} from './storage.js';
import { AppState, BookingRequest, Equipment, MessageType, SCHEDULE, User } from './types.js';

/* ------------------------------------------------------------------ */
/* État                                                                */
/* ------------------------------------------------------------------ */

function createInitialState(): AppState {
  const rooms = loadRooms();
  const users = loadUsers();
  const firstUser = users[0];
  if (firstUser === undefined) {
    throw new Error('Aucun utilisateur disponible.');
  }
  const storedUserId = loadCurrentUserId(firstUser.id);
  const currentUserId = users.some((u) => u.id === storedUserId) ? storedUserId : firstUser.id;

  return {
    rooms,
    users,
    bookings: loadBookings(),
    currentUserId,
    selectedDate: toIsoDate(new Date()),
    filter: { minCapacity: 1, equipments: [] },
  };
}

let state: AppState = createInitialState();
const ui: UiElements = queryUiElements();

function getCurrentUser(): User {
  const user = state.users.find((u) => u.id === state.currentUserId);
  if (user === undefined) {
    throw new Error('Utilisateur courant introuvable.');
  }
  return user;
}

/* ------------------------------------------------------------------ */
/* Rendu global                                                        */
/* ------------------------------------------------------------------ */

function render(highlightBookingId?: string): void {
  const now = new Date();
  const currentUser = getCurrentUser();
  const visibleRooms = filterRooms(state.rooms, state.filter);

  ui.datePicker.value = state.selectedDate;
  ui.capacityFilter.value = String(state.filter.minCapacity);
  ui.capacityOutput.value = String(state.filter.minCapacity);

  renderPlanning(ui, {
    rooms: visibleRooms,
    totalRooms: state.rooms.length,
    bookings: state.bookings,
    users: state.users,
    currentUser,
    date: state.selectedDate,
    now,
    highlightBookingId,
  });
  renderMyBookings(ui.myBookings, state.bookings, state.rooms, currentUser, now);
}

/* ------------------------------------------------------------------ */
/* Navigation par date                                                 */
/* ------------------------------------------------------------------ */

function shiftSelectedDate(days: number): void {
  const date = parseIsoDate(state.selectedDate);
  date.setDate(date.getDate() + days);
  state = { ...state, selectedDate: toIsoDate(date) };
  render();
}

/* ------------------------------------------------------------------ */
/* Réservation                                                         */
/* ------------------------------------------------------------------ */

/** Premier créneau à venir pour pré-remplir le formulaire (ou l'ouverture si autre jour). */
function defaultStartTime(date: string): string {
  const now = new Date();
  if (date !== toIsoDate(now)) {
    return '09:00';
  }
  const minutes = now.getHours() * 60 + now.getMinutes();
  const rounded = Math.ceil(minutes / SCHEDULE.slotMinutes) * SCHEDULE.slotMinutes;
  const clamped = Math.min(Math.max(rounded, SCHEDULE.openingMinutes), SCHEDULE.closingMinutes - SCHEDULE.slotMinutes);
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

function openDialogFor(roomId: string | undefined, start: string): void {
  const visibleRooms = filterRooms(state.rooms, state.filter);
  // Le formulaire propose toutes les salles : les filtres servent à l'affichage, pas à restreindre le choix.
  const allRooms = filterRooms(state.rooms, { minCapacity: 1, equipments: [] });
  const fallbackRoom = visibleRooms[0] ?? allRooms[0];
  if (fallbackRoom === undefined) {
    showToast(ui.toastRegion, 'Aucune salle disponible.', MessageType.Error);
    return;
  }
  openBookingDialog(ui, allRooms, {
    roomId: roomId ?? fallbackRoom.id,
    date: state.selectedDate,
    start,
  });
}

function readFormRequest(): BookingRequest {
  return {
    roomId: ui.roomSelect.value,
    userId: state.currentUserId,
    date: ui.dateInput.value,
    slot: { start: ui.startSelect.value, end: ui.endSelect.value },
    title: ui.titleInput.value,
    attendees: Number(ui.attendeesInput.value),
  };
}

function handleBookingSubmit(event: SubmitEvent): void {
  event.preventDefault();
  const request = readFormRequest();
  const result = createBooking(request, state.rooms, state.bookings);

  if (!result.ok) {
    const errors = [...result.errors];
    // Après un conflit, on suggère des salles libres sur le même créneau.
    if (errors.some((e) => e.startsWith('Conflit'))) {
      const alternatives = suggestAlternativeRooms(request, state.rooms, state.bookings);
      if (alternatives.length > 0) {
        errors.push(`Salles libres sur ce créneau : ${alternatives.map((r) => r.name).join(', ')}.`);
      }
    }
    showFormErrors(ui, errors);
    return;
  }

  const { booking, bookings } = result.value;
  state = { ...state, bookings, selectedDate: booking.date };
  saveBookings(state.bookings);
  closeBookingDialog(ui);

  const room = state.rooms.find((r) => r.id === booking.roomId);
  render(booking.id);
  showToast(
    ui.toastRegion,
    `Réservation confirmée : ${room?.name ?? 'salle'}, ${formatLongDate(booking.date)} de ${booking.slot.start} à ${booking.slot.end}.`,
    MessageType.Success,
  );
}

function handleCancel(bookingId: string): void {
  const booking = state.bookings.find((b) => b.id === bookingId);
  if (booking === undefined) {
    return;
  }
  const confirmed = window.confirm(
    `Annuler la réservation « ${booking.title} » (${booking.slot.start} – ${booking.slot.end}) ?`,
  );
  if (!confirmed) {
    return;
  }

  const result = cancelBooking(bookingId, getCurrentUser(), state.bookings);
  if (!result.ok) {
    result.errors.forEach((error) => showToast(ui.toastRegion, error, MessageType.Error));
    return;
  }
  state = { ...state, bookings: result.value.bookings };
  saveBookings(state.bookings);
  render();
  showToast(ui.toastRegion, `Réservation « ${result.value.cancelled.title} » annulée.`, MessageType.Success);
}

/** Clic sur un bloc occupé : annulation si autorisé, sinon simple information. */
function handleBookingBlockClick(bookingId: string): void {
  const booking = state.bookings.find((b) => b.id === bookingId);
  if (booking === undefined) {
    return;
  }
  if (canCancel(booking, getCurrentUser())) {
    handleCancel(bookingId);
    return;
  }
  const owner = state.users.find((u) => u.id === booking.userId);
  showToast(
    ui.toastRegion,
    `Créneau réservé par ${owner?.name ?? 'un collègue'} (${booking.slot.start} – ${booking.slot.end}).`,
    MessageType.Info,
  );
}

/* ------------------------------------------------------------------ */
/* Écouteurs d'événements                                              */
/* ------------------------------------------------------------------ */

function bindEvents(): void {
  // Changement d'utilisateur simulé (pas d'authentification réelle dans cette SAE).
  ui.userSelect.addEventListener('change', () => {
    state = { ...state, currentUserId: ui.userSelect.value };
    saveCurrentUserId(state.currentUserId);
    render();
    showToast(ui.toastRegion, `Vous êtes maintenant connecté en tant que ${getCurrentUser().name}.`, MessageType.Info);
  });

  ui.resetButton.addEventListener('click', () => {
    if (!window.confirm('Supprimer toutes les réservations et restaurer les données de démonstration ?')) {
      return;
    }
    resetStorage();
    state = createInitialState();
    renderUserSelect(ui.userSelect, state.users, state.currentUserId);
    renderEquipmentFilters(ui.equipmentFilters, state.filter.equipments);
    render();
    showToast(ui.toastRegion, 'Données réinitialisées.', MessageType.Info);
  });

  // Navigation dans le calendrier
  ui.datePicker.addEventListener('change', () => {
    if (ui.datePicker.value !== '') {
      state = { ...state, selectedDate: ui.datePicker.value };
      render();
    }
  });
  ui.prevDay.addEventListener('click', () => shiftSelectedDate(-1));
  ui.nextDay.addEventListener('click', () => shiftSelectedDate(1));
  ui.todayButton.addEventListener('click', () => {
    state = { ...state, selectedDate: toIsoDate(new Date()) };
    render();
    ui.planningTitle.focus();
  });

  // Filtres
  ui.capacityFilter.addEventListener('input', () => {
    state = { ...state, filter: { ...state.filter, minCapacity: Number(ui.capacityFilter.value) } };
    render();
  });

  ui.equipmentFilters.addEventListener('change', () => {
    const checked = Array.from(
      ui.equipmentFilters.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'),
    )
      .map((input) => input.value)
      .filter((value): value is Equipment => (Object.values(Equipment) as string[]).includes(value));
    state = { ...state, filter: { ...state.filter, equipments: checked } };
    render();
  });

  ui.clearFilters.addEventListener('click', () => {
    state = { ...state, filter: { minCapacity: 1, equipments: [] } };
    renderEquipmentFilters(ui.equipmentFilters, []);
    render();
  });

  // Délégation d'événements sur le planning : un seul écouteur pour toutes les cellules.
  ui.planning.addEventListener('click', (event: MouseEvent) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const target = event.target.closest<HTMLButtonElement>('button[data-action]');
    if (target === null || target.disabled) {
      return;
    }
    const { action, roomId, start, bookingId } = target.dataset;
    if (action === 'book' && roomId !== undefined && start !== undefined) {
      openDialogFor(roomId, start);
    } else if (action === 'booking' && bookingId !== undefined) {
      handleBookingBlockClick(bookingId);
    }
  });

  ui.myBookings.addEventListener('click', (event: MouseEvent) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const target = event.target.closest<HTMLButtonElement>('button[data-action="cancel"]');
    const bookingId = target?.dataset.bookingId;
    if (bookingId !== undefined) {
      handleCancel(bookingId);
    }
  });

  ui.newBookingButton.addEventListener('click', () => {
    openDialogFor(undefined, defaultStartTime(state.selectedDate));
  });

  // Formulaire
  ui.form.addEventListener('submit', handleBookingSubmit);
  ui.startSelect.addEventListener('change', () => updateEndOptions(ui, ui.endSelect.value));
  ui.roomSelect.addEventListener('change', () => updateRoomDetails(ui, state.rooms));
  ui.dialog.addEventListener('click', (event: MouseEvent) => {
    const target = event.target;
    // Fermeture via les boutons dédiés ou par clic sur l'arrière-plan.
    if (target === ui.dialog || (target instanceof Element && target.closest('[data-close-dialog]') !== null)) {
      closeBookingDialog(ui);
    }
  });

  // Rafraîchissement périodique : les créneaux qui deviennent passés se grisent.
  window.setInterval(() => {
    if (!ui.dialog.open) {
      render();
    }
  }, 60_000);
}

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */

function init(): void {
  renderUserSelect(ui.userSelect, state.users, state.currentUserId);
  renderEquipmentFilters(ui.equipmentFilters, state.filter.equipments);
  ui.capacityFilter.max = String(Math.max(...state.rooms.map((r) => r.capacity)));
  bindEvents();
  render();
}

init();
