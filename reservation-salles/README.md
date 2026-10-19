# MeetBook — Réservation de salles de réunion

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![HTML5](https://img.shields.io/badge/HTML5-s%C3%A9mantique-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-Grid%20%26%20Flexbox-1572B6?logo=css3&logoColor=white)
![Sans framework](https://img.shields.io/badge/framework-aucun-lightgrey)
![Licence](https://img.shields.io/badge/licence-p%C3%A9dagogique-green)

> **SAE — Développement d'applications** · BUT Informatique 2ᵉ année, parcours **RACD**
> (Réalisation d'Applications : Conception et Développement)

## Contexte

Une entreprise souhaite remplacer son tableur partagé par une application web permettant à ses
collaborateurs de consulter la disponibilité des salles de réunion et de les réserver, sans
risque de **double réservation**.

L'application est développée en **TypeScript pur** (aucun framework : ni React, ni Vue, ni
bibliothèque externe), en HTML5 sémantique et en CSS3 moderne. Les données sont persistées dans
le `localStorage` du navigateur ; un jeu de données de démonstration est injecté au premier
lancement.

### Fonctionnalités

- Planning visuel journalier (salles × créneaux de 30 min, de 08:00 à 19:00).
- Navigation par date (sélecteur, jour précédent / suivant, retour à aujourd'hui).
- Filtres par **capacité minimale** et par **équipements requis** (vidéoprojecteur, visio…).
- Réservation par clic sur un créneau libre ou via le bouton « Nouvelle réservation » (modale `<dialog>`).
- **Rejet des chevauchements** avec message explicite et **suggestion de salles libres** sur le même créneau.
- Annulation de ses propres réservations (un profil administrateur peut tout annuler).
- Distinction visuelle : libre, occupé, ma réservation, créneau passé.
- Changement d'utilisateur simulé, bouton de réinitialisation des données.
- Responsive (mobile → desktop), thème sombre automatique, navigation clavier, zones `aria-live`.

## Arborescence

```
reservation-salles/
├── index.html              # Interface (structure sémantique, modale, zones ARIA)
├── style.css               # Design system : variables, grid/flexbox, états, responsive
├── tsconfig.json           # Configuration TypeScript (strict)
├── package.json            # Scripts npm (build, watch, serve)
├── README.md
├── src/
│   ├── types.ts            # Interfaces Room, Booking, TimeSlot, User + enums
│   ├── storage.ts          # Accès localStorage, validation du JSON, données mock
│   ├── bookingService.ts   # Logique métier pure (dont détection des chevauchements)
│   ├── domRenderer.ts      # Rendu DOM : planning, liste, formulaire, notifications
│   └── main.ts             # Point d'entrée : état, événements, orchestration
└── dist/                   # JavaScript généré par tsc (non versionné)
```

## Architecture logicielle

L'application suit une séparation en couches inspirée du modèle **MVC** :

| Couche | Fichier | Responsabilité | Dépendances |
|---|---|---|---|
| Modèle (types) | `types.ts` | Contrats de données, enums, règles horaires | aucune |
| Persistance | `storage.ts` | Lecture/écriture `localStorage`, validation, mock | `types` |
| Métier | `bookingService.ts` | Règles de gestion, chevauchements, filtres | `types` |
| Vue | `domRenderer.ts` | Construction et mise à jour du DOM | `types`, `bookingService` |
| Contrôleur | `main.ts` | État global, écouteurs, orchestration | toutes |

Principes appliqués :

- **Logique métier pure** : `bookingService.ts` ne touche ni au DOM ni au stockage. Chaque fonction
  reçoit ses données et retourne un résultat ; elle est donc testable isolément.
- **Immuabilité** : créer ou annuler une réservation retourne un **nouveau tableau** ; seul
  `main.ts` remplace l'état (`state = { ...state, bookings }`).
- **Type `Result<T>`** : les opérations métier renvoient soit `{ ok: true, value }`, soit
  `{ ok: false, errors }`. Le compilateur oblige l'appelant à traiter les deux cas.
- **Validation à l'exécution** : le JSON relu depuis le `localStorage` passe par des *type guards*
  (`isRoom`, `isBooking`…). Des données corrompues déclenchent une réinitialisation propre au lieu
  d'un plantage.
- **Sécurité** : tout contenu saisi est inséré via `textContent`, jamais `innerHTML` (pas de XSS).
- **Délégation d'événements** : un seul écouteur sur le planning gère tous les créneaux, même
  après un nouveau rendu.
- **Typage strict** : `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`… et **aucun `any`**.

## Gestion des conflits d'horaires

### Modélisation

Un créneau est un **intervalle semi-ouvert** `[début, fin[` : l'heure de fin est exclue. Ainsi,
une réunion `09:00–10:00` suivie d'une réunion `10:00–11:00` dans la même salle est **autorisée**.
Les heures `"HH:MM"` sont converties en minutes depuis minuit pour être comparées numériquement.

### Algorithme

Deux intervalles `A = [a₁, a₂[` et `B = [b₁, b₂[` se chevauchent **si et seulement si** :

```
a₁ < b₂  ET  b₁ < a₂
```

```ts
export function slotsOverlap(a: TimeSlot, b: TimeSlot): boolean {
  const aStart = timeToMinutes(a.start);
  const aEnd = timeToMinutes(a.end);
  const bStart = timeToMinutes(b.start);
  const bEnd = timeToMinutes(b.end);
  return aStart < bEnd && bStart < aEnd;
}
```

Cette condition unique couvre tous les cas, sans enchaînement de `if` :

```
Existant :           [10:00 ──────── 11:00[
Partiel gauche :  [09:30 ──── 10:30[                 → conflit
Partiel droit :                [10:30 ──── 11:30[    → conflit
Inclus :               [10:15 ─ 10:45[               → conflit
Englobant :     [09:00 ──────────────────── 12:00[   → conflit
Identique :          [10:00 ──────── 11:00[          → conflit
Adjacent :                           [11:00 ── 12:00[ → OK
Disjoint :  [08:00 ─ 09:00[                          → OK
```

`findConflicts()` filtre ensuite les réservations ayant **la même salle**, **la même date** et un
intervalle qui chevauche la demande (complexité O(n) sur le nombre de réservations).

### Chaîne de validation

Avant toute création, `validateBookingRequest()` contrôle dans l'ordre :

1. existence de la salle, objet de 3 à 80 caractères ;
2. nombre de participants entier, ≥ 1 et ≤ capacité de la salle ;
3. format de la date et des heures ;
4. fin strictement après le début, horaires dans la plage 08:00–19:00, multiples de 30 min, durée ≤ 4 h ;
5. créneau non passé ;
6. **absence de chevauchement** avec une réservation existante de la même salle.

Toutes les erreurs sont renvoyées en une fois pour que l'utilisateur corrige tout d'un coup. En cas
de conflit, `suggestAlternativeRooms()` propose les salles assez grandes et libres sur le même créneau.

## Installation et lancement

### Prérequis

- [Node.js](https://nodejs.org/) 18 ou plus récent (fournit `npm` et `npx`).
- Un navigateur récent (Chrome, Firefox, Edge, Safari) — le support de `<dialog>` est requis.

### Étapes

1. **Récupérer le projet** et se placer dans le dossier :

   ```bash
   cd reservation-salles
   ```

2. **Installer le compilateur TypeScript** (dépendance de développement locale) :

   ```bash
   npm install
   ```

   > Variante sans `package.json` : `npm install -g typescript`, la commande `tsc` devient globale.

3. **Compiler** le TypeScript vers `dist/` :

   ```bash
   npx tsc
   ```

   Pendant le développement, la recompilation automatique se lance avec `npx tsc --watch`.

4. **Lancer un serveur local** à la racine du projet (au choix) :

   ```bash
   npx http-server . -p 8080 -c-1        # Node.js
   python3 -m http.server 8080            # Python 3
   ```

   Ou utiliser l'extension **Live Server** de VS Code sur `index.html`.

5. **Ouvrir** <http://localhost:8080> dans le navigateur.

Raccourci : `npm start` enchaîne la compilation et le serveur.

> ⚠️ Ouvrir `index.html` directement en `file://` ne fonctionne pas : les navigateurs bloquent le
> chargement des modules ES (`type="module"`) hors d'un serveur HTTP.

### Scripts npm

| Commande | Effet |
|---|---|
| `npm run build` | Compile une fois (`tsc`) |
| `npm run watch` | Recompile à chaque modification |
| `npm run serve` | Sert le projet sur le port 8080 |
| `npm start` | Compile puis lance le serveur |
| `npm run clean` | Supprime le dossier `dist/` |

## Scénario de démonstration

1. Choisir un utilisateur dans l'en-tête (ex. *Camille Martin*).
2. Cliquer sur un créneau libre d'**Orion** à 09:00 demain, saisir un objet, confirmer.
3. Ouvrir « Nouvelle réservation », choisir **Orion** de 09:30 à 10:30 : la réservation est
   **refusée**, le conflit est détaillé et des salles libres sont proposées.
4. Réserver 10:00–11:00 dans Orion : accepté (créneaux adjacents).
5. Annuler depuis « Mes prochaines réservations » ou en cliquant sur le bloc.
6. Se connecter en *Admin Services Généraux* pour annuler la réservation d'un collègue.

## Pistes d'amélioration

- Back-end REST (Node/Express ou PHP) et base de données relationnelle à la place du `localStorage`.
- Authentification réelle et gestion des droits côté serveur.
- Réservations récurrentes (hebdomadaires) et vue semaine.
- Tests unitaires automatisés de `bookingService.ts` (Vitest ou Jest).
- Export iCalendar (`.ics`) des réservations.
