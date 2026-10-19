/**
 * bookingService.ts
 * Logique métier pure : aucune dépendance au DOM ni au localStorage.
 * Chaque fonction reçoit ses données en paramètre et retourne un résultat,
 * ce qui la rend testable de manière isolée.
 */

import {
  Booking,
  BookingRequest,
  Result,
  Room,
  RoomFilter,
  SCHEDULE,
  TimeSlot,
  User,
  UserRole,
} from './types.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------ */
/* Conversions horaires                                                */
/* ------------------------------------------------------------------ */

/** Convertit "HH:MM" en minutes depuis minuit. Lève une erreur si le format est invalide. */
export function timeToMinutes(time: string): number {
  const match = TIME_PATTERN.exec(time);
  if (match === null) {
    throw new Error(`Format horaire invalide : "${time}"`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Convertit un nombre de minutes depuis minuit en "HH:MM". */
export function minutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function isValidTime(time: string): boolean {
  return TIME_PATTERN.test(time);
}

export function slotDuration(slot: TimeSlot): number {
  return timeToMinutes(slot.end) - timeToMinutes(slot.start);
}

/** Génère toutes les bornes de la journée ouvrée (08:00, 08:30, …, 19:00). */
export function generateDayTimes(): string[] {
  const times: string[] = [];
  for (let m = SCHEDULE.openingMinutes; m <= SCHEDULE.closingMinutes; m += SCHEDULE.slotMinutes) {
    times.push(minutesToTime(m));
  }
  return times;
}

/** Découpe la journée en créneaux élémentaires de 30 minutes (cellules du planning). */
export function generateDaySlots(): TimeSlot[] {
  const times = generateDayTimes();
  const slots: TimeSlot[] = [];
  for (let i = 0; i < times.length - 1; i++) {
    const start = times[i];
    const end = times[i + 1];
    if (start !== undefined && end !== undefined) {
      slots.push({ start, end });
    }
  }
  return slots;
}

/* ------------------------------------------------------------------ */
/* Algorithme critique : détection des chevauchements                  */
/* ------------------------------------------------------------------ */

/**
 * Deux intervalles semi-ouverts [aStart, aEnd[ et [bStart, bEnd[ se chevauchent
 * si et seulement si aStart < bEnd ET bStart < aEnd.
 *
 * Cette condition unique couvre tous les cas : inclusion totale, recouvrement
 * partiel à gauche ou à droite, et créneaux identiques. Les créneaux
 * simplement adjacents (fin de A = début de B) ne sont PAS en conflit.
 */
export function slotsOverlap(a: TimeSlot, b: TimeSlot): boolean {
  const aStart = timeToMinutes(a.start);
  const aEnd = timeToMinutes(a.end);
  const bStart = timeToMinutes(b.start);
  const bEnd = timeToMinutes(b.end);
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Retourne les réservations existantes en conflit avec la demande :
 * même salle, même date et intervalles qui se chevauchent.
 * `ignoreBookingId` permet d'exclure une réservation (cas d'une modification).
 */
export function findConflicts(
  request: Pick<BookingRequest, 'roomId' | 'date' | 'slot'>,
  bookings: readonly Booking[],
  ignoreBookingId?: string,
): Booking[] {
  return bookings.filter(
    (booking) =>
      booking.id !== ignoreBookingId &&
      booking.roomId === request.roomId &&
      booking.date === request.date &&
      slotsOverlap(booking.slot, request.slot),
  );
}

/* ------------------------------------------------------------------ */
/* Validation d'une demande de réservation                             */
/* ------------------------------------------------------------------ */

/**
 * Vérifie toutes les règles métier dans un ordre précis.
 * Les erreurs de format bloquent les contrôles suivants (inutile de chercher
 * des conflits sur un horaire illisible).
 */
export function validateBookingRequest(
  request: BookingRequest,
  rooms: readonly Room[],
  bookings: readonly Booking[],
  now: Date = new Date(),
): string[] {
  const errors: string[] = [];

  const room = rooms.find((r) => r.id === request.roomId);
  if (room === undefined) {
    errors.push('La salle sélectionnée est introuvable.');
  }
  if (request.title.trim().length < 3) {
    errors.push("L'objet de la réunion doit contenir au moins 3 caractères.");
  }
  if (request.title.trim().length > 80) {
    errors.push("L'objet de la réunion ne doit pas dépasser 80 caractères.");
  }
  if (!Number.isInteger(request.attendees) || request.attendees < 1) {
    errors.push('Le nombre de participants doit être un entier supérieur ou égal à 1.');
  } else if (room !== undefined && request.attendees > room.capacity) {
    errors.push(`La salle ${room.name} accueille au maximum ${room.capacity} personnes.`);
  }
  if (!DATE_PATTERN.test(request.date)) {
    errors.push('La date est invalide.');
  }
  if (!isValidTime(request.slot.start) || !isValidTime(request.slot.end)) {
    errors.push('Les horaires doivent être au format HH:MM.');
    return errors;
  }

  const start = timeToMinutes(request.slot.start);
  const end = timeToMinutes(request.slot.end);

  if (end <= start) {
    errors.push("L'heure de fin doit être postérieure à l'heure de début.");
  }
  if (start < SCHEDULE.openingMinutes || end > SCHEDULE.closingMinutes) {
    errors.push(
      `Les réservations sont possibles entre ${minutesToTime(SCHEDULE.openingMinutes)} et ${minutesToTime(SCHEDULE.closingMinutes)}.`,
    );
  }
  if (start % SCHEDULE.slotMinutes !== 0 || end % SCHEDULE.slotMinutes !== 0) {
    errors.push(`Les horaires doivent être des multiples de ${SCHEDULE.slotMinutes} minutes.`);
  }
  if (end - start > SCHEDULE.maxDurationMinutes) {
    errors.push(`Une réservation ne peut pas dépasser ${SCHEDULE.maxDurationMinutes / 60} heures.`);
  }

  // Interdiction de réserver dans le passé (comparaison de chaînes ISO valide).
  const today = toLocalIsoDate(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (request.date < today || (request.date === today && start < nowMinutes)) {
    errors.push('Impossible de réserver un créneau déjà passé.');
  }

  // Le contrôle de chevauchement n'a de sens que si l'intervalle est cohérent.
  if (end > start) {
    const conflicts = findConflicts(request, bookings);
    conflicts.forEach((conflict) => {
      errors.push(
        `Conflit avec « ${conflict.title} » (${conflict.slot.start} – ${conflict.slot.end}) dans cette salle.`,
      );
    });
  }

  return errors;
}

function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/* ------------------------------------------------------------------ */
/* Opérations CRUD (immuables : on retourne un nouveau tableau)        */
/* ------------------------------------------------------------------ */

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `bk-${crypto.randomUUID()}`;
  }
  return `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Crée une réservation si toutes les règles sont respectées. */
export function createBooking(
  request: BookingRequest,
  rooms: readonly Room[],
  bookings: readonly Booking[],
  now: Date = new Date(),
): Result<{ booking: Booking; bookings: Booking[] }> {
  const errors = validateBookingRequest(request, rooms, bookings, now);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const booking: Booking = {
    id: generateId(),
    roomId: request.roomId,
    userId: request.userId,
    date: request.date,
    slot: { start: request.slot.start, end: request.slot.end },
    title: request.title.trim(),
    attendees: request.attendees,
    createdAt: now.toISOString(),
  };

  return { ok: true, value: { booking, bookings: [...bookings, booking] } };
}

/** Un utilisateur peut annuler ses réservations ; un administrateur peut tout annuler. */
export function canCancel(booking: Booking, user: User): boolean {
  return booking.userId === user.id || user.role === UserRole.Admin;
}

export function cancelBooking(
  bookingId: string,
  user: User,
  bookings: readonly Booking[],
): Result<{ cancelled: Booking; bookings: Booking[] }> {
  const target = bookings.find((b) => b.id === bookingId);
  if (target === undefined) {
    return { ok: false, errors: ['Cette réservation n’existe plus.'] };
  }
  if (!canCancel(target, user)) {
    return { ok: false, errors: ['Vous ne pouvez annuler que vos propres réservations.'] };
  }
  return {
    ok: true,
    value: { cancelled: target, bookings: bookings.filter((b) => b.id !== bookingId) },
  };
}

/* ------------------------------------------------------------------ */
/* Requêtes                                                            */
/* ------------------------------------------------------------------ */

/** Filtre les salles selon la capacité minimale et les équipements requis (tous). */
export function filterRooms(rooms: readonly Room[], filter: RoomFilter): Room[] {
  return rooms
    .filter(
      (room) =>
        room.capacity >= filter.minCapacity &&
        filter.equipments.every((eq) => room.equipments.includes(eq)),
    )
    .sort((a, b) => a.capacity - b.capacity || a.name.localeCompare(b.name, 'fr'));
}

/** Réservations d'une journée, triées par heure de début. */
export function getBookingsForDate(bookings: readonly Booking[], date: string): Booking[] {
  return bookings
    .filter((b) => b.date === date)
    .sort((a, b) => timeToMinutes(a.slot.start) - timeToMinutes(b.slot.start));
}

/** Réservation occupant une salle sur un créneau élémentaire donné, s'il y en a une. */
export function findBookingAt(
  bookings: readonly Booking[],
  roomId: string,
  date: string,
  slot: TimeSlot,
): Booking | undefined {
  return bookings.find((b) => b.roomId === roomId && b.date === date && slotsOverlap(b.slot, slot));
}

/** Réservations à venir d'un utilisateur, de la plus proche à la plus lointaine. */
export function getUpcomingBookingsForUser(
  bookings: readonly Booking[],
  userId: string,
  now: Date = new Date(),
): Booking[] {
  const today = toLocalIsoDate(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return bookings
    .filter(
      (b) =>
        b.userId === userId &&
        (b.date > today || (b.date === today && timeToMinutes(b.slot.end) > nowMinutes)),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || timeToMinutes(a.slot.start) - timeToMinutes(b.slot.start));
}

/**
 * Propose des salles alternatives libres sur le même créneau et assez grandes,
 * utilisé pour aider l'utilisateur après un rejet pour conflit.
 */
export function suggestAlternativeRooms(
  request: BookingRequest,
  rooms: readonly Room[],
  bookings: readonly Booking[],
): Room[] {
  return rooms.filter(
    (room) =>
      room.id !== request.roomId &&
      room.capacity >= request.attendees &&
      findConflicts({ ...request, roomId: room.id }, bookings).length === 0,
  );
}

/** Taux d'occupation d'une salle sur la journée ouvrée (0 à 1). */
export function occupancyRate(bookings: readonly Booking[], roomId: string, date: string): number {
  const dayLength = SCHEDULE.closingMinutes - SCHEDULE.openingMinutes;
  const booked = bookings
    .filter((b) => b.roomId === roomId && b.date === date)
    .reduce((total, b) => total + slotDuration(b.slot), 0);
  return Math.min(1, booked / dayLength);
}
