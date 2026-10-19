/**
 * storage.ts
 * Couche d'accès aux données (DAO) basée sur le localStorage du navigateur.
 * Toute donnée lue est validée à l'exécution par des "type guards" : le
 * localStorage pouvant être modifié à la main, on ne fait jamais confiance
 * au JSON relu sans vérification.
 */

import { Booking, Equipment, Room, TimeSlot, User, UserRole } from './types.js';

const STORAGE_KEYS = {
  rooms: 'meetbook.rooms',
  users: 'meetbook.users',
  bookings: 'meetbook.bookings',
  currentUser: 'meetbook.currentUser',
} as const;

/* ------------------------------------------------------------------ */
/* Jeu de données initial (mock)                                       */
/* ------------------------------------------------------------------ */

const MOCK_ROOMS: Room[] = [
  {
    id: 'room-atlas',
    name: 'Atlas',
    floor: 1,
    capacity: 4,
    equipments: [Equipment.Screen, Equipment.Whiteboard],
    description: 'Petite salle pour points rapides et entretiens.',
  },
  {
    id: 'room-orion',
    name: 'Orion',
    floor: 1,
    capacity: 8,
    equipments: [Equipment.Projector, Equipment.Whiteboard, Equipment.ConferencePhone],
    description: "Salle polyvalente pour réunions d'équipe.",
  },
  {
    id: 'room-vega',
    name: 'Vega',
    floor: 2,
    capacity: 12,
    equipments: [Equipment.Projector, Equipment.VideoConference, Equipment.ConferencePhone],
    description: 'Équipée pour les réunions hybrides et clients distants.',
  },
  {
    id: 'room-sirius',
    name: 'Sirius',
    floor: 2,
    capacity: 6,
    equipments: [Equipment.Screen, Equipment.VideoConference],
    description: 'Salle de visio compacte, isolation phonique renforcée.',
  },
  {
    id: 'room-pegase',
    name: 'Pégase',
    floor: 3,
    capacity: 20,
    equipments: [
      Equipment.Projector,
      Equipment.Screen,
      Equipment.Whiteboard,
      Equipment.VideoConference,
      Equipment.ConferencePhone,
    ],
    description: 'Grande salle du conseil, idéale pour les présentations.',
  },
];

const MOCK_USERS: User[] = [
  { id: 'user-1', name: 'Camille Martin', email: 'camille.martin@entreprise.fr', department: 'Produit', role: UserRole.Employee },
  { id: 'user-2', name: 'Yanis Bernard', email: 'yanis.bernard@entreprise.fr', department: 'Développement', role: UserRole.Employee },
  { id: 'user-3', name: 'Inès Lefèvre', email: 'ines.lefevre@entreprise.fr', department: 'Ressources humaines', role: UserRole.Employee },
  { id: 'user-admin', name: 'Admin Services Généraux', email: 'services.generaux@entreprise.fr', department: 'Services généraux', role: UserRole.Admin },
];

/** Formate une date locale en "YYYY-MM-DD" (sans passer par l'UTC). */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Les réservations de démonstration sont générées autour de la date du jour. */
function buildMockBookings(): Booking[] {
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const d0 = toIsoDate(today);
  const d1 = toIsoDate(tomorrow);
  const createdAt = new Date().toISOString();

  return [
    { id: 'bk-demo-1', roomId: 'room-orion', userId: 'user-1', date: d0, slot: { start: '09:00', end: '10:30' }, title: 'Daily produit', attendees: 6, createdAt },
    { id: 'bk-demo-2', roomId: 'room-vega', userId: 'user-2', date: d0, slot: { start: '10:00', end: '12:00' }, title: 'Démo client Acme', attendees: 10, createdAt },
    { id: 'bk-demo-3', roomId: 'room-atlas', userId: 'user-3', date: d0, slot: { start: '14:00', end: '15:00' }, title: 'Entretien candidat', attendees: 3, createdAt },
    { id: 'bk-demo-4', roomId: 'room-pegase', userId: 'user-admin', date: d0, slot: { start: '16:00', end: '18:00' }, title: 'Comité de direction', attendees: 15, createdAt },
    { id: 'bk-demo-5', roomId: 'room-sirius', userId: 'user-2', date: d1, slot: { start: '11:00', end: '12:00' }, title: 'Point sprint', attendees: 5, createdAt },
  ];
}

/* ------------------------------------------------------------------ */
/* Type guards : validation du JSON relu                               */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEquipment(value: unknown): value is Equipment {
  return typeof value === 'string' && (Object.values(Equipment) as string[]).includes(value);
}

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (Object.values(UserRole) as string[]).includes(value);
}

function isTimeSlot(value: unknown): value is TimeSlot {
  return isRecord(value) && typeof value.start === 'string' && typeof value.end === 'string';
}

function isRoom(value: unknown): value is Room {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.floor === 'number' &&
    typeof value.capacity === 'number' &&
    typeof value.description === 'string' &&
    Array.isArray(value.equipments) &&
    value.equipments.every(isEquipment)
  );
}

function isUser(value: unknown): value is User {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.email === 'string' &&
    typeof value.department === 'string' &&
    isUserRole(value.role)
  );
}

function isBooking(value: unknown): value is Booking {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.roomId === 'string' &&
    typeof value.userId === 'string' &&
    typeof value.date === 'string' &&
    typeof value.title === 'string' &&
    typeof value.attendees === 'number' &&
    typeof value.createdAt === 'string' &&
    isTimeSlot(value.slot)
  );
}

/* ------------------------------------------------------------------ */
/* Lecture / écriture génériques                                       */
/* ------------------------------------------------------------------ */

/**
 * Lit une liste typée depuis le localStorage.
 * Retourne null si la clé est absente, illisible ou si un élément est invalide,
 * afin que l'appelant puisse réinitialiser proprement les données.
 */
function readList<T>(key: string, guard: (value: unknown) => value is T): T[] | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(guard)) {
      console.warn(`[storage] Données corrompues pour "${key}", réinitialisation.`);
      return null;
    }
    return parsed;
  } catch (error: unknown) {
    console.warn(`[storage] Lecture impossible pour "${key}".`, error);
    return null;
  }
}

function writeList<T>(key: string, items: readonly T[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(items));
  } catch (error: unknown) {
    // Quota dépassé ou stockage désactivé (navigation privée stricte).
    console.error(`[storage] Écriture impossible pour "${key}".`, error);
  }
}

/* ------------------------------------------------------------------ */
/* API publique                                                        */
/* ------------------------------------------------------------------ */

export function loadRooms(): Room[] {
  const rooms = readList(STORAGE_KEYS.rooms, isRoom);
  if (rooms === null) {
    writeList(STORAGE_KEYS.rooms, MOCK_ROOMS);
    return MOCK_ROOMS.map((room) => ({ ...room, equipments: [...room.equipments] }));
  }
  return rooms;
}

export function loadUsers(): User[] {
  const users = readList(STORAGE_KEYS.users, isUser);
  if (users === null) {
    writeList(STORAGE_KEYS.users, MOCK_USERS);
    return MOCK_USERS.map((user) => ({ ...user }));
  }
  return users;
}

export function loadBookings(): Booking[] {
  const bookings = readList(STORAGE_KEYS.bookings, isBooking);
  if (bookings === null) {
    const mock = buildMockBookings();
    writeList(STORAGE_KEYS.bookings, mock);
    return mock;
  }
  return bookings;
}

export function saveBookings(bookings: readonly Booking[]): void {
  writeList(STORAGE_KEYS.bookings, bookings);
}

export function loadCurrentUserId(fallbackId: string): string {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.currentUser) ?? fallbackId;
  } catch {
    return fallbackId;
  }
}

export function saveCurrentUserId(userId: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS.currentUser, userId);
  } catch (error: unknown) {
    console.error('[storage] Impossible de mémoriser l’utilisateur courant.', error);
  }
}

/** Supprime toutes les données de l'application (bouton "Réinitialiser"). */
export function resetStorage(): void {
  try {
    Object.values(STORAGE_KEYS).forEach((key) => window.localStorage.removeItem(key));
  } catch (error: unknown) {
    console.error('[storage] Réinitialisation impossible.', error);
  }
}
