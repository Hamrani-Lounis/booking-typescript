/**
 * types.ts
 * Définitions du domaine métier : salles, utilisateurs, créneaux et réservations.
 * Ce fichier ne contient aucune logique, uniquement des contrats de données
 * et quelques constantes de configuration partagées.
 */

/** Équipements pouvant être présents dans une salle. */
export enum Equipment {
  Projector = 'PROJECTOR',
  Screen = 'SCREEN',
  Whiteboard = 'WHITEBOARD',
  VideoConference = 'VIDEO_CONFERENCE',
  ConferencePhone = 'CONFERENCE_PHONE',
}

/** Libellés affichés dans l'interface pour chaque équipement. */
export const EQUIPMENT_LABELS: Readonly<Record<Equipment, string>> = {
  [Equipment.Projector]: 'Vidéoprojecteur',
  [Equipment.Screen]: 'Écran TV',
  [Equipment.Whiteboard]: 'Tableau blanc',
  [Equipment.VideoConference]: 'Visioconférence',
  [Equipment.ConferencePhone]: 'Pieuvre téléphonique',
};

/** Rôle d'un utilisateur : un administrateur peut annuler toutes les réservations. */
export enum UserRole {
  Employee = 'EMPLOYEE',
  Admin = 'ADMIN',
}

/** Type de message affiché à l'utilisateur (notifications). */
export enum MessageType {
  Success = 'success',
  Error = 'error',
  Info = 'info',
}

export interface User {
  readonly id: string;
  name: string;
  email: string;
  department: string;
  role: UserRole;
}

export interface Room {
  readonly id: string;
  name: string;
  floor: number;
  capacity: number;
  equipments: Equipment[];
  description: string;
}

/**
 * Créneau horaire au format "HH:MM".
 * Convention : intervalle semi-ouvert [start, end[ (l'heure de fin est exclue),
 * ce qui permet d'enchaîner 09:00–10:00 puis 10:00–11:00 sans conflit.
 */
export interface TimeSlot {
  start: string;
  end: string;
}

export interface Booking {
  readonly id: string;
  roomId: string;
  userId: string;
  /** Date locale au format ISO "YYYY-MM-DD". */
  date: string;
  slot: TimeSlot;
  title: string;
  attendees: number;
  /** Horodatage de création au format ISO 8601. */
  createdAt: string;
}

/** Données saisies par l'utilisateur avant la création d'une réservation. */
export interface BookingRequest {
  roomId: string;
  userId: string;
  date: string;
  slot: TimeSlot;
  title: string;
  attendees: number;
}

/** Critères de filtrage des salles affichées dans le planning. */
export interface RoomFilter {
  minCapacity: number;
  equipments: Equipment[];
}

/** État global de l'application, manipulé uniquement par main.ts. */
export interface AppState {
  rooms: Room[];
  users: User[];
  bookings: Booking[];
  currentUserId: string;
  selectedDate: string;
  filter: RoomFilter;
}

/** Résultat d'une opération métier : succès avec valeur, ou échec avec erreurs. */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: string[] };

/** Règles horaires de l'entreprise (en minutes depuis minuit). */
export const SCHEDULE = {
  openingMinutes: 8 * 60,
  closingMinutes: 19 * 60,
  slotMinutes: 30,
  maxDurationMinutes: 4 * 60,
} as const;
